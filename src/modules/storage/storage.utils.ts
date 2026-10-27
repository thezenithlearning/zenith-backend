import crypto from 'node:crypto';
import path from 'node:path';

import { STORAGE_ERROR_CODES } from './storage.constants.js';
import { StorageError } from './storage.error.js';
import type { StoragePath } from './storage.types.js';

const MAX_SLUG_LENGTH = 100;

export function slugify(value: string): string {
  if (!value) {
    return 'file';
  }

  const slug = value
    .normalize('NFKD')
    // strip accent marks
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    // drop characters that are unsafe in a URL
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/g, '');

  return slug || 'file';
}

export function buildStorageFolder(storagePath: StoragePath): string {
  const segments = [storagePath.module, storagePath.entity, storagePath.category]
    .filter(Boolean)
    .map((segment) => slugify(segment as string));

  if (segments.length === 0) {
    throw new StorageError(
      'At least a module is required to build the storage path',
      STORAGE_ERROR_CODES.INVALID_PATH,
      400,
    );
  }

  return segments.join('/');
}

/**
 * Accepts a folder string ("blogs/banners") and maps it onto the
 * module / entity / category structure. Two segments mean module + category.
 */
export function folderToStoragePath(folder: string): StoragePath {
  const segments = folder
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length <= 1) return { module: segments[0] ?? '' };
  if (segments.length === 2) return { module: segments[0], category: segments[1] };

  return { module: segments[0], entity: segments[1], category: segments.slice(2).join('-') };
}

export function getFileExtension(originalName: string): string | null {
  const extension = path.extname(originalName).toLowerCase();

  if (!extension) {
    return null;
  }

  // Protect against odd or injected extensions.
  if (!/^\.[a-z0-9]{1,20}$/.test(extension)) {
    return null;
  }

  return extension;
}

/** `<slug>--<uuid><.ext>` — readable for SEO, collision-proof by the uuid. */
export function createSeoFileName(seoName: string, originalName: string): string {
  const slug = slugify(seoName);
  const uuid = crypto.randomUUID();
  const extension = getFileExtension(originalName) ?? '';

  return `${slug}--${uuid}${extension}`;
}

/** Full object key for a new upload: `<folder>/<slug>--<uuid><.ext>`. */
export function createObjectKey(
  storagePath: StoragePath,
  seoName: string,
  originalName: string,
): { key: string; folder: string; fileName: string } {
  const folder = buildStorageFolder(storagePath);
  const fileName = createSeoFileName(seoName, originalName);

  return { key: `${folder}/${fileName}`, folder, fileName };
}

/** Multer decodes multipart filenames as latin1; recover UTF-8 names. */
export function decodeOriginalName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');

  return decoded.includes('�') ? name : decoded;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 Bytes';
  }

  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);

  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

/** Rejects empty keys and path-traversal attempts before they reach a provider. */
export function assertValidKey(key: string): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new StorageError('Invalid object key', STORAGE_ERROR_CODES.INVALID_KEY, 400);
  }
}
