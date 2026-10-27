// scripts/migrateAssets.ts
//
// One-time (and safely re-runnable) migration to the unified asset library.
//
//   Phase 1  legacy `files` collection  ->  `assets` collection (same _id)
//   Phase 2  files referenced by courses, blogs, programs, PYQs and ads
//            that are not in `assets` yet get a library record
//
// Nothing is deleted, moved or re-uploaded; only missing `assets` records are
// created. Without --apply it is a dry run that prints what it would do.
//
//   npm run migrate:assets             # dry run
//   npm run migrate:assets -- --apply  # write
//
import mongoose from 'mongoose';
import path from 'node:path';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

import { connectDB, disconnectDB } from '../config/db.js';
import { ENV } from '../config/env.js';
import s3 from '../config/s3.config.js';
import { AssetModel } from '../modules/asset/asset.model.js';
import { assetService } from '../modules/asset/asset.service.js';
import { FileModel } from '../modules/file-upload/file.model.js';
import { getFileExtension } from '../modules/storage/storage.utils.js';
import { resolveAssetUrl, stripAssetBase } from '../utils/asset.js';

const APPLY = process.argv.includes('--apply');

/** Collections whose documents embed uploaded files or file URLs. */
const REFERENCING_COLLECTIONS = ['courses', 'blogs', 'programs', 'pyqs', 'advertisements'];

const EXTENSION_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

const ABSOLUTE_URL = /^https?:\/\//i;

/** Keys phase 1 would create in a dry run, so phase 2 does not count them again. */
const plannedKeys = new Set<string>();

const counters = {
  filesSeen: 0,
  filesMigrated: 0,
  filesAlready: 0,
  filesSkippedExternal: 0,
  referencesSeen: 0,
  referencesRegistered: 0,
  referencesAlready: 0,
  referencesMissingInStorage: 0,
};

const folderOf = (key: string): string => key.split('/').slice(0, -1).join('/') || 'uploads';

interface Reference {
  key: string;
  title?: string;
  alt?: string;
  caption?: string;
  description?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  createdAt?: Date;
  source: string;
}

/** Walks a document and collects every managed file it points to. */
const collectReferences = (node: unknown, source: string, out: Map<string, Reference>): void => {
  if (typeof node === 'string') {
    // A plain URL string that belongs to the media CDN / old API / S3 bucket.
    const key = stripAssetBase(node);
    if (key !== node && key && !ABSOLUTE_URL.test(key)) {
      if (!out.has(key)) out.set(key, { key, source });
    }
    return;
  }

  if (node === null || typeof node !== 'object') return;
  if (node instanceof Date || node instanceof mongoose.Types.ObjectId) return;

  if (Array.isArray(node)) {
    node.forEach((item) => collectReferences(item, source, out));
    return;
  }

  const object = node as Record<string, unknown>;
  const keyField = [object.storageKey, object.publicId].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );

  if (keyField && !ABSOLUTE_URL.test(keyField)) {
    const key = keyField.trim().replace(/^\/+/, '');
    const existing = out.get(key);
    out.set(key, {
      ...(existing ?? {}),
      key,
      source,
      title: typeof object.title === 'string' ? object.title : existing?.title,
      alt: typeof object.altText === 'string' ? object.altText : existing?.alt,
      caption: typeof object.caption === 'string' ? object.caption : existing?.caption,
      description: typeof object.description === 'string' ? object.description : existing?.description,
      originalName: typeof object.originalName === 'string' ? object.originalName : existing?.originalName,
      mimeType: typeof object.mimeType === 'string' ? object.mimeType : existing?.mimeType,
      size: typeof object.size === 'number' ? object.size : existing?.size,
    });
  }

  for (const value of Object.values(object)) collectReferences(value, source, out);
};

const headObject = async (key: string): Promise<{ size: number; mimeType: string } | null> => {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: ENV.AWS_BUCKET_NAME, Key: key }));

    return {
      size: head.ContentLength ?? 0,
      mimeType: head.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
};

const migrateLegacyFiles = async (): Promise<void> => {
  console.log('\n— Phase 1: legacy files collection → assets');

  const cursor = FileModel.find().sort({ createdAt: 1 }).lean().cursor();

  for await (const legacy of cursor) {
    counters.filesSeen += 1;

    const key = (legacy.storageKey || legacy.publicId || '').trim().replace(/^\/+/, '');

    if (!key || ABSOLUTE_URL.test(key)) {
      counters.filesSkippedExternal += 1;
      console.log(`  skip (external/legacy id): ${legacy.originalName} (${legacy.publicId})`);
      continue;
    }

    const already = await AssetModel.exists({ $or: [{ key }, { _id: legacy._id }] });

    if (already) {
      counters.filesAlready += 1;
      continue;
    }

    counters.filesMigrated += 1;
    plannedKeys.add(key);
    console.log(`  ${APPLY ? 'migrate' : 'would migrate'}: ${key}`);

    if (!APPLY) continue;

    await assetService.registerStoredObject({
      id: String(legacy._id),
      stored: {
        provider: 's3',
        key,
        url: resolveAssetUrl(key),
        fileName: legacy.fileName || path.basename(key),
        originalName: legacy.originalName,
        mimeType: legacy.mimeType,
        extension: legacy.format ? `.${legacy.format.replace(/^\./, '')}` : getFileExtension(key),
        size: legacy.size,
        folder: folderOf(key),
      },
      metadata: {
        title: legacy.title || undefined,
        alt: legacy.altText || undefined,
        caption: legacy.caption || undefined,
        description: legacy.description || undefined,
      },
      uploadStatus: legacy.status ?? 'ready',
      legacyFileId: String(legacy._id),
      createdAt: legacy.uploadedAt ?? (legacy as { createdAt?: Date }).createdAt,
    });
  }
};

const registerReferencedFiles = async (): Promise<void> => {
  console.log('\n— Phase 2: files used by courses, blogs, programs, PYQs and ads');

  const db = mongoose.connection.db;
  if (!db) throw new Error('Database connection is not ready');

  const existingNames = new Set((await db.listCollections().toArray()).map((item) => item.name));

  const references = new Map<string, Reference>();

  for (const name of REFERENCING_COLLECTIONS) {
    if (!existingNames.has(name)) continue;

    for await (const document of db.collection(name).find({})) {
      const before = references.size;
      collectReferences(document, name, references);
      console.log(`  ${name}/${String(document._id)}: +${references.size - before} file(s)`);
    }
  }

  for (const reference of references.values()) {
    counters.referencesSeen += 1;

    if (plannedKeys.has(reference.key) || (await AssetModel.exists({ key: reference.key }))) {
      counters.referencesAlready += 1;
      continue;
    }

    const originalName = reference.originalName || path.basename(reference.key);
    let { size, mimeType } = reference;

    if (!size || !mimeType) {
      const head = await headObject(reference.key);

      if (!head) {
        counters.referencesMissingInStorage += 1;
        console.log(`  missing in storage, not registered: ${reference.key} (${reference.source})`);
        continue;
      }

      size = size || head.size;
      mimeType = mimeType || EXTENSION_MIME[path.extname(reference.key).toLowerCase()] || head.mimeType;
    }

    counters.referencesRegistered += 1;
    console.log(`  ${APPLY ? 'register' : 'would register'}: ${reference.key} (${reference.source})`);

    if (!APPLY) continue;

    await assetService.registerStoredObject({
      stored: {
        provider: 's3',
        key: reference.key,
        url: resolveAssetUrl(reference.key),
        fileName: path.basename(reference.key),
        originalName,
        mimeType,
        extension: getFileExtension(originalName) ?? getFileExtension(reference.key),
        size,
        folder: folderOf(reference.key),
      },
      metadata: {
        title: reference.title || undefined,
        alt: reference.alt || undefined,
        caption: reference.caption || undefined,
        description: reference.description || undefined,
      },
    });
  }
};

const main = async (): Promise<void> => {
  console.log(APPLY ? 'APPLY mode: writing to the database.' : 'DRY RUN: nothing will be written (use --apply).');

  await connectDB();
  await AssetModel.init();

  await migrateLegacyFiles();
  await registerReferencedFiles();

  console.log('\nSummary', counters);
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');
};

main()
  .then(() => disconnectDB())
  .catch(async (error: unknown) => {
    console.error('Migration failed:', error);
    await disconnectDB().catch(() => undefined);
    process.exit(1);
  });
