import { randomBytes } from 'node:crypto';
import type { QueryFilter } from 'mongoose';

import { logger } from '../../config/logger.js';
import { StorageError } from '../storage/storage.error.js';
import { storageService } from '../storage/storage.service.js';
import { folderToStoragePath } from '../storage/storage.utils.js';
import type { StoredFile } from '../storage/storage.types.js';

import { AssetModel } from './asset.model.js';
import { AssetError } from './asset.error.js';
import {
  buildFileFields,
  buildFileName,
  escapeRegex,
  extractImageDimensions,
  getBaseName,
  isDuplicateKeyError,
  normalizeExtension,
  resolveAssetType,
  resolveSlug,
} from './asset.utils.js';
import type {
  Asset,
  AssetDocument,
  AssetMetadataInput,
  AssetUploadStatus,
  BulkDeleteAssetsResult,
  ImageDimensions,
  ListAssetsQuery,
  PaginatedAssets,
  UpdateAssetInput,
} from './asset.types.js';

/** Stored-object facts needed to register a file in the library. */
export type RegisterStoredInput = Pick<
  StoredFile,
  | 'provider'
  | 'key'
  | 'url'
  | 'fileName'
  | 'originalName'
  | 'mimeType'
  | 'extension'
  | 'size'
  | 'folder'
>;

export interface RegisterAssetInput {
  /** Fixed `_id` (e.g. the upload session id, so completing twice is idempotent). */
  id?: string;
  stored: RegisterStoredInput;
  uploadStatus?: AssetUploadStatus;
  dimensions?: ImageDimensions | null;
  duration?: number | null;
  pages?: number | null;
  metadata?: AssetMetadataInput;
  legacyFileId?: string;
  createdAt?: Date;
}

const humanize = (fileName: string): string =>
  getBaseName(fileName)
    .replace(/--[0-9a-f-]{36}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const MAX_SLUG_ATTEMPTS = 5;

/**
 * The single asset library behind the dashboard's File Manager. Every upload
 * in the product (file manager, courses, blogs, programs, PYQs) is recorded
 * here, and the bytes live in object storage behind the storage module.
 */
class AssetService {
  /**
   * Records a stored object in the `assets` collection. Idempotent per
   * storage key: registering the same key twice returns the existing record.
   */
  async registerStoredObject(input: RegisterAssetInput): Promise<AssetDocument> {
    const { stored, metadata = {}, dimensions, uploadStatus = 'ready' } = input;

    const assetType = resolveAssetType(stored.mimeType);
    const title =
      metadata.title?.trim() || humanize(stored.originalName) || humanize(stored.fileName);
    const extension = normalizeExtension(stored.extension);

    const createdAt = input.createdAt ?? new Date();

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = await this.availableSlug(metadata.slug ?? title, attempt);

      const fileFields = buildFileFields(
        { ...stored, uploadedAt: '', sizeFormatted: '' } as StoredFile,
        slug,
        assetType,
        dimensions ?? null,
      );

      try {
        const record = await AssetModel.findOneAndUpdate(
          { key: stored.key },
          {
            $setOnInsert: {
              ...(input.id ? { _id: input.id } : {}),
              ...fileFields,
              slug,
              extension,
              alt: assetType === 'image' ? metadata.alt?.trim() || title : (metadata.alt ?? ''),
              title,
              caption: metadata.caption ?? '',
              description: metadata.description ?? '',
              seoTitle: metadata.seoTitle ?? '',
              seoDescription: metadata.seoDescription ?? '',
              keywords: metadata.keywords ?? [],
              tags: metadata.tags ?? [],
              indexable: metadata.indexable ?? true,
              searchable: metadata.searchable ?? true,
              visibility: metadata.visibility ?? 'public',
              status: metadata.status ?? 'active',
              uploadStatus,
              duration: input.duration ?? null,
              pages: input.pages ?? null,
              ...(input.legacyFileId ? { legacyFileId: input.legacyFileId } : {}),
              createdAt,
              updatedAt: createdAt,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
            setDefaultsOnInsert: true,
            // Timestamps are set explicitly so migrated files keep their original upload date.
            timestamps: false,
          },
        ).lean<AssetDocument>();

        if (record) return record;
      } catch (error) {
        lastError = error;

        if (!isDuplicateKeyError(error)) throw error;

        // Same key registered concurrently: return the winner.
        const existing = await AssetModel.findOne({ key: stored.key }).lean<AssetDocument>();
        if (existing) return existing;

        // Otherwise the slug collided in a race; try another suffix.
      }
    }

    throw lastError instanceof Error ? lastError : AssetError.slugConflict(title);
  }

  async markUploadReady(id: string): Promise<void> {
    await AssetModel.updateOne(
      { _id: id },
      { $set: { uploadStatus: 'ready' }, $unset: { errorMessage: 1 } },
    );
  }

  async markUploadFailed(id: string, message: string): Promise<void> {
    await AssetModel.updateOne(
      { _id: id },
      { $set: { uploadStatus: 'failed', errorMessage: message } },
    );
  }

  /**
   * Uploads are copied to storage by an in-process background job, so a
   * restart or deploy mid-copy leaves a record stuck in "processing". Records
   * that stay in that state past `olderThanMs` are resolved against storage:
   * the object is there -> ready, otherwise -> failed (delete and re-upload).
   */
  async resolveStaleUploads(
    olderThanMs = 60 * 60 * 1000,
  ): Promise<{ ready: number; failed: number }> {
    const stale = await AssetModel.find({
      uploadStatus: 'processing',
      createdAt: { $lt: new Date(Date.now() - olderThanMs) },
    })
      .select('_id key provider')
      .lean<Array<Pick<AssetDocument, '_id' | 'key' | 'provider'>>>();

    let ready = 0;
    let failed = 0;

    for (const asset of stale) {
      try {
        if (await storageService.exists(asset.key, asset.provider)) {
          await this.markUploadReady(String(asset._id));
          ready += 1;
        } else {
          await this.markUploadFailed(
            String(asset._id),
            'The upload was interrupted before the file reached storage. Delete this entry and upload the file again.',
          );
          failed += 1;
        }
      } catch (error) {
        // Storage unreachable: leave the record alone and try again next start.
        logger.warn({ err: error, key: asset.key }, 'Could not resolve a stale upload');
      }
    }

    return { ready, failed };
  }

  async listAssets(query: ListAssetsQuery): Promise<PaginatedAssets> {
    const { page, limit, sortBy, sortOrder } = query;

    const filter = this.buildListFilter(query);

    const [items, total] = await Promise.all([
      AssetModel.find(filter)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AssetDocument[]>(),
      AssetModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getAssetById(id: string): Promise<AssetDocument> {
    const asset = await AssetModel.findById(id).lean<AssetDocument>();

    if (!asset) {
      throw AssetError.notFound(id);
    }

    return asset;
  }

  async findByKey(key: string): Promise<AssetDocument | null> {
    return AssetModel.findOne({ key }).lean<AssetDocument>();
  }

  /**
   * Metadata-only update. The stored object (key, url, size...) is never
   * touched here; use replaceAssetFile to change the file itself.
   */
  async updateAsset(id: string, input: UpdateAssetInput): Promise<AssetDocument> {
    const existing = await this.getAssetById(id);

    const changes: Partial<Asset> = { ...input };

    if (input.slug !== undefined) {
      const slug = resolveSlug(input.slug);

      if (slug !== existing.slug) {
        await this.assertSlugAvailable(slug, id);
      }

      changes.slug = slug;
      changes.fileName = buildFileName(slug, existing.extension);
    }

    try {
      const updated = await AssetModel.findByIdAndUpdate(
        id,
        { $set: changes },
        { new: true, runValidators: true },
      ).lean<AssetDocument>();

      if (!updated) {
        throw AssetError.notFound(id);
      }

      return updated;
    } catch (error) {
      if (isDuplicateKeyError(error) && changes.slug) {
        throw AssetError.slugConflict(changes.slug);
      }

      throw error;
    }
  }

  /**
   * Swaps the underlying file while keeping the asset's id, slug and
   * descriptive metadata. The new object is uploaded first; the old one is
   * removed only after the database points at the new one.
   */
  async replaceAssetFile(
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<AssetDocument> {
    if (!file) {
      throw AssetError.fileRequired();
    }

    const existing = await this.getAssetById(id);

    const assetType = resolveAssetType(file.mimetype);

    if (assetType !== existing.assetType) {
      throw AssetError.typeMismatch(existing.assetType, assetType);
    }

    const dimensions = await extractImageDimensions(file.buffer ?? file.path, file.mimetype);

    const stored = await storageService.uploadFile({
      file,
      seoName: existing.slug,
      path: folderToStoragePath(existing.folder),
    });

    let updated: AssetDocument | null;

    try {
      updated = await AssetModel.findByIdAndUpdate(
        id,
        {
          $set: {
            ...buildFileFields(stored, existing.slug, assetType, dimensions),
            uploadStatus: 'ready',
          },
          $unset: { errorMessage: 1 },
        },
        { new: true, runValidators: true },
      ).lean<AssetDocument>();
    } catch (error) {
      await this.discardStoredFile(stored);
      throw error;
    }

    if (!updated) {
      // Asset was deleted while the new file was uploading.
      await this.discardStoredFile(stored);
      throw AssetError.notFound(id);
    }

    await this.discardStoredFile(existing);

    return updated;
  }

  async deleteAsset(id: string): Promise<{ id: string; deleted: true }> {
    const asset = await this.getAssetById(id);

    // Storage first: if the provider fails the record survives and can be
    // retried. Deleting a missing object is a no-op, so retries are safe.
    await storageService.deleteFile(asset.key, asset.provider);
    await AssetModel.deleteOne({ _id: asset._id });

    return { id, deleted: true };
  }

  /** Removes the library record for a key after its object was deleted elsewhere. */
  async forgetKey(key: string): Promise<void> {
    await AssetModel.deleteMany({ key });
  }

  async deleteAssets(ids: string[]): Promise<BulkDeleteAssetsResult> {
    const assets = await AssetModel.find({ _id: { $in: ids } })
      .select('_id key provider')
      .lean<Array<Pick<AssetDocument, '_id' | 'key' | 'provider'>>>();

    const foundIds = new Set(assets.map((asset) => String(asset._id)));
    const notFound = ids.filter((id) => !foundIds.has(id));

    // Assets may live on different providers after a migration.
    const byProvider = new Map<string, typeof assets>();

    for (const asset of assets) {
      byProvider.set(asset.provider, [...(byProvider.get(asset.provider) ?? []), asset]);
    }

    const deletedIds: string[] = [];
    const failed: BulkDeleteAssetsResult['failed'] = [];

    for (const [provider, group] of byProvider) {
      const idByKey = new Map(group.map((asset) => [asset.key, String(asset._id)]));

      let result: Awaited<ReturnType<typeof storageService.deleteFiles>>;

      try {
        result = await storageService.deleteFiles(
          group.map((asset) => asset.key),
          provider,
        );
      } catch (error) {
        // e.g. provider no longer configured: keep the records, report them.
        for (const asset of group) {
          failed.push({
            id: String(asset._id),
            key: asset.key,
            code: error instanceof StorageError ? error.code : undefined,
            message: error instanceof Error ? error.message : undefined,
          });
        }

        continue;
      }

      for (const key of result.deleted) {
        const id = idByKey.get(key);

        if (id) deletedIds.push(id);
      }

      for (const item of result.failed) {
        failed.push({
          id: idByKey.get(item.key) ?? 'unknown',
          key: item.key,
          code: item.code,
          message: item.message,
        });
      }
    }

    if (deletedIds.length > 0) {
      await AssetModel.deleteMany({ _id: { $in: deletedIds } });
    }

    return { deleted: deletedIds, notFound, failed };
  }

  private buildListFilter(query: ListAssetsQuery): QueryFilter<Asset> {
    const filter: QueryFilter<Asset> = {};

    if (query.search) filter.$text = { $search: query.search };
    if (query.assetType) filter.assetType = query.assetType;
    if (query.mimeType) filter.mimeType = query.mimeType.toLowerCase();
    if (query.tag) filter.tags = query.tag.toLowerCase();
    if (query.visibility) filter.visibility = query.visibility;
    if (query.status) filter.status = query.status;

    if (query.folder) {
      const folder = query.folder.replace(/^\/+|\/+$/g, '');

      // Matches the folder itself and everything nested under it.
      filter.folder = new RegExp(`^${escapeRegex(folder)}(/|$)`);
    }

    return filter;
  }

  /** `base`, then `base-xxxxxx` with a random suffix on later attempts. */
  private async availableSlug(base: string, attempt: number): Promise<string> {
    const root = resolveSlug(base);
    const slug = attempt === 0 ? root : `${root}-${randomBytes(3).toString('hex')}`;

    if (await AssetModel.exists({ slug })) {
      return `${root}-${randomBytes(3).toString('hex')}`;
    }

    return slug;
  }

  private async assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
    const conflict = await AssetModel.exists({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });

    if (conflict) {
      throw AssetError.slugConflict(slug);
    }
  }

  /**
   * Best-effort removal of an orphaned stored object. Never throws, so the
   * original error (or a successful result) is not masked.
   */
  private async discardStoredFile(object: { key: string; provider: string }): Promise<void> {
    try {
      await storageService.deleteFile(object.key, object.provider);
    } catch (error) {
      logger.error(
        { err: error, key: object.key, provider: object.provider },
        'Failed to remove orphaned storage object',
      );
    }
  }
}

export const assetService = new AssetService();
