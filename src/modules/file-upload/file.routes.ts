import path from 'node:path';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { logger } from '../../config/logger.js';
import { authorize, protect } from '../../middlewares/auth.middleware.js';
import { removeTempFile } from '../../utils/fileUpload.js';
import { ASSET_TYPES, MAX_PAGE_SIZE } from '../asset/asset.constants.js';
import { assetService } from '../asset/asset.service.js';
import { extractImageDimensions } from '../asset/asset.utils.js';
import {
  assetIdParamSchema,
  assetMetadataSchema,
  bulkDeleteAssetsSchema,
} from '../asset/asset.validation.js';
import { storageService } from '../storage/storage.service.js';
import { decodeOriginalName, getFileExtension } from '../storage/storage.utils.js';
import { toFileDto } from './file.dto.js';
import { managedUpload } from './file.upload.js';
import multipartRoutes from './file.multipart.js';
import { assertManagedFileSize } from './file.policy.js';

const router = Router();
router.use('/uploads', multipartRoutes);

// The File Manager is an admin tool. The files themselves are public and are
// served by the CDN, so nothing here is needed to display them on the site.
router.use(protect, authorize('admin'));

/** Top-level storage folder for files uploaded from the File Manager. */
export const UPLOAD_MODULE = 'uploads';

const LIST_ALL_LIMIT = 5000;

/**
 * Pulls the editable metadata out of a multipart/JSON body. The dashboard
 * sends `altText`; the library field is `alt`.
 */
const metadataFromBody = (body: Request['body']) => {
  const source = (body ?? {}) as Record<string, unknown>;
  const raw: Record<string, unknown> = {};

  for (const field of [
    'title',
    'description',
    'caption',
    'seoTitle',
    'seoDescription',
    'keywords',
    'tags',
    'visibility',
    'slug',
  ]) {
    if (typeof source[field] === 'string') raw[field] = (source[field] as string).trim();
  }

  if (typeof source.altText === 'string') raw.alt = source.altText.trim();
  if (typeof source.assetStatus === 'string') raw.status = source.assetStatus.trim();

  return assetMetadataSchema.parse(raw);
};

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  folder: z.string().trim().min(1).max(300).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'size']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Upload File
 *
 * The bytes are spooled to a temp file, the library record is created
 * immediately (status "processing"), and the copy to S3 continues in the
 * background so slow storage can never hit proxy/CDN idle timeouts.
 */
router.post(
  '/',
  managedUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    // Once the response is sent the background job owns the temp file.
    let handedOff = false;

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File is required' });
      }

      const upload = req.file;
      assertManagedFileSize(upload.size);

      const metadata = metadataFromBody(req.body);
      const originalName = decodeOriginalName(upload.originalname);
      const seoName = metadata.title?.trim() || path.basename(originalName, path.extname(originalName));

      // The title (auto-filled from the file name in the dashboard, editable
      // by the user) becomes the readable part of the public URL.
      const reserved = storageService.reserveKey({ module: UPLOAD_MODULE }, seoName, originalName);

      const record = await assetService.registerStoredObject({
        stored: {
          provider: 's3',
          key: reserved.key,
          url: storageService.getPublicUrl(reserved.key),
          fileName: reserved.fileName,
          originalName,
          mimeType: upload.mimetype,
          extension: getFileExtension(originalName),
          size: upload.size,
          folder: reserved.folder,
        },
        metadata,
        uploadStatus: 'processing',
        dimensions: await extractImageDimensions(upload.path, upload.mimetype),
      });

      // Respond as soon as the bytes have reached the server. Copying a large
      // file to S3 can take minutes, longer than proxy/CDN idle timeouts, which
      // would otherwise drop the connection ("Network error") after 100%.
      handedOff = true;
      res.status(202).json({
        success: true,
        message: 'File received and is being processed',
        data: toFileDto(record),
      });

      void (async () => {
        try {
          await storageService.uploadFile({
            file: upload,
            seoName,
            path: { module: UPLOAD_MODULE },
            reserved,
          });
          await assetService.markUploadReady(String(record._id));
        } catch (error) {
          logger.error({ err: error, storageKey: reserved.key }, 'Background S3 upload failed');
          await assetService
            .markUploadFailed(
              String(record._id),
              error instanceof Error ? error.message : 'Storage upload failed',
            )
            .catch(() => undefined);
        } finally {
          await removeTempFile(upload);
        }
      })();

      return undefined;
    } catch (error) {
      return next(error);
    } finally {
      if (!handedOff) await removeTempFile(req.file);
    }
  },
);

/**
 * Bulk delete
 */
router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = bulkDeleteAssetsSchema.parse(req.body);
    const result = await assetService.deleteAssets(ids);

    return res.status(200).json({
      success: true,
      message: `${result.deleted.length} files deleted`,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * List files.
 *
 * Without `page` every file is returned (the dashboard filters client-side);
 * with `page`/`limit` the result is paginated. Optional filters: assetType,
 * folder, tag, search.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const paginated = query.page !== undefined || query.limit !== undefined;

    const { items, pagination } = await assetService.listAssets({
      page: query.page ?? 1,
      limit: paginated ? (query.limit ?? 24) : LIST_ALL_LIMIT,
      assetType: query.assetType,
      folder: query.folder,
      tag: query.tag,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items.map(toFileDto),
      ...(paginated ? { pagination } : { total: pagination.total }),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Get a single file
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = assetIdParamSchema.parse(req.params);
    const asset = await assetService.getAssetById(id);

    return res.status(200).json({ success: true, data: toFileDto(asset) });
  } catch (error) {
    return next(error);
  }
});

/**
 * Update metadata and/or replace the file itself.
 */
router.put(
  '/:id',
  managedUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = assetIdParamSchema.parse(req.params);
      const metadata = metadataFromBody(req.body);

      let asset = await assetService.getAssetById(id);

      if (req.file) {
        assertManagedFileSize(req.file.size);
        asset = await assetService.replaceAssetFile(id, req.file);
      }

      if (Object.keys(metadata).length > 0) {
        asset = await assetService.updateAsset(id, metadata);
      }

      return res.status(200).json({
        success: true,
        message: 'File updated successfully',
        data: toFileDto(asset),
      });
    } catch (error) {
      return next(error);
    } finally {
      await removeTempFile(req.file);
    }
  },
);

/**
 * Delete a file (object storage first, then the record).
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = assetIdParamSchema.parse(req.params);
    await assetService.deleteAsset(id);

    return res.status(200).json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    return next(error);
  }
});

export default router;
