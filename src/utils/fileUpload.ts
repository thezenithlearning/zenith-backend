import { unlink } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';
import { assetService } from '../modules/asset/asset.service.js';
import { extractImageDimensions } from '../modules/asset/asset.utils.js';
import { storageService } from '../modules/storage/storage.service.js';
import { decodeOriginalName, folderToStoragePath } from '../modules/storage/storage.utils.js';
import type { StoredFile } from '../modules/storage/storage.types.js';
import type { IUploadedFile } from '../types/uploaded-file.type.js';

/**
 * Thin adapter between feature modules (blogs, courses, programs, PYQs…) and
 * the storage module. Feature code keeps working with `IUploadedFile`; every
 * byte still goes through `storageService`, so naming, CDN URLs, rollback and
 * provider handling live in exactly one place. Each stored file is also
 * recorded in the asset library, so the dashboard's File Manager lists every
 * file the website uses.
 */

/** Records the file in the asset library. Never fails the upload itself. */
const registerAsset = async (
  stored: StoredFile,
  file: Express.Multer.File,
  title?: string,
): Promise<void> => {
  try {
    await assetService.registerStoredObject({
      stored,
      metadata: title ? { title } : {},
      dimensions: await extractImageDimensions(file.buffer ?? file.path, stored.mimeType),
    });
  } catch (error) {
    logger.warn({ err: error, key: stored.key }, 'Uploaded file could not be added to the asset library');
  }
};

const toUploadedFile = async (
  stored: StoredFile,
  file: Express.Multer.File,
): Promise<IUploadedFile> => {
  const dimensions = file.buffer
    ? await extractImageDimensions(file.buffer, stored.mimeType)
    : null;

  return {
    url: stored.url,
    storageKey: stored.key,
    mimeType: stored.mimeType,
    originalName: stored.originalName,
    size: stored.size,
    extension: stored.extension?.replace(/^\./, '') ?? '',
    uploadedAt: new Date(stored.uploadedAt),
    ...(stored.etag ? { etag: stored.etag } : {}),
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
  };
};

/**
 * Uploads one file under `folder` ("module/category", e.g. "blogs/banners").
 * `displayName` becomes the readable slug in the object key; it falls back to
 * the original file name.
 */
export const uploadFile = async (
  file: Express.Multer.File,
  folder: string,
  displayName?: string,
): Promise<IUploadedFile> => {
  if (!file) {
    throw new AppError('No file provided', 400, 'BAD_REQUEST');
  }

  const originalName = decodeOriginalName(file.originalname);
  const seoName = displayName?.trim() || path.basename(originalName, path.extname(originalName));

  const stored = await storageService.uploadFile({
    file,
    seoName,
    path: folderToStoragePath(folder),
  });

  await registerAsset(stored, file, displayName?.trim());

  return toUploadedFile(stored, file);
};

export const uploadMultipleFiles = async (
  files: Express.Multer.File[],
  folder: string,
): Promise<IUploadedFile[]> => {
  if (!files.length) return [];

  const stored = await storageService.uploadMultipleFiles({
    files,
    path: folderToStoragePath(folder),
    seoName: (file) => {
      const originalName = decodeOriginalName(file.originalname);

      return path.basename(originalName, path.extname(originalName));
    },
  });

  await Promise.all(stored.map((item, index) => registerAsset(item, files[index])));

  return Promise.all(stored.map((item, index) => toUploadedFile(item, files[index])));
};

export const deleteFile = async (storageKey: string): Promise<void> => {
  if (!storageKey) return;

  await storageService.deleteFile(storageKey);
  await assetService.forgetKey(storageKey).catch((error: unknown) => {
    logger.warn({ err: error, storageKey }, 'Asset library record could not be removed');
  });
};

/** Removes the temp file multer wrote for disk-backed uploads. */
export const removeTempFile = async (file?: Express.Multer.File): Promise<void> => {
  if (!file?.path) return;

  try {
    await unlink(file.path);
  } catch (error) {
    logger.warn({ err: error, path: file.path }, 'Failed to remove temp upload');
  }
};
