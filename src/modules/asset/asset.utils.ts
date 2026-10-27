import path from 'path';
import sharp from 'sharp';

import { slugify } from '../storage/storage.utils.js';
import type { StoredFile } from '../storage/storage.types.js';
import { ARCHIVE_MIME_TYPES, DOCUMENT_MIME_TYPES } from './asset.constants.js';
import type { Asset, AssetOrientation, AssetType, ImageDimensions } from './asset.types.js';

export function resolveAssetType(mimeType: string): AssetType {
  const mime = mimeType.toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (DOCUMENT_MIME_TYPES.has(mime) || mime.includes('officedocument')) {
    return 'document';
  }
  if (ARCHIVE_MIME_TYPES.has(mime)) return 'archive';

  return 'other';
}

export function getOrientation(width: number, height: number): AssetOrientation {
  if (width === height) return 'square';

  return width > height ? 'landscape' : 'portrait';
}

/**
 * Reads image dimensions from an in-memory buffer or a temp file path. Returns null for
 * non-images or files sharp cannot decode, so a bad header never
 * blocks the upload.
 */
export async function extractImageDimensions(
  body: Buffer | string,
  mimeType: string,
): Promise<ImageDimensions | null> {
  if (!mimeType.toLowerCase().startsWith('image/')) {
    return null;
  }

  try {
    const metadata = await sharp(body).metadata();

    if (!metadata.width || !metadata.height) {
      return null;
    }

    // EXIF orientations 5-8 are rotated 90°, so width/height are swapped.
    const isRotated = (metadata.orientation ?? 1) >= 5;
    const width = isRotated ? metadata.height : metadata.width;
    const height = isRotated ? metadata.width : metadata.height;

    return {
      width,
      height,
      aspectRatio: Number((width / height).toFixed(4)),
      orientation: getOrientation(width, height),
    };
  } catch {
    return null;
  }
}

export function getBaseName(fileName: string): string {
  return path.parse(fileName).name;
}

/** "webp" for ".webp", null when there is no extension. */
export function normalizeExtension(extension: string | null): string | null {
  return extension ? extension.replace(/^\./, '').toLowerCase() : null;
}

export function buildFileName(slug: string, extension: string | null): string {
  return extension ? `${slug}.${extension}` : slug;
}

export function resolveSlug(candidate: string): string {
  return slugify(candidate);
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Storage + file-derived fields shared by create and replace.
 */
export function buildFileFields(
  stored: StoredFile,
  slug: string,
  assetType: AssetType,
  dimensions: ImageDimensions | null,
): Pick<
  Asset,
  | 'originalName'
  | 'fileName'
  | 'provider'
  | 'key'
  | 'url'
  | 'folder'
  | 'extension'
  | 'mimeType'
  | 'assetType'
  | 'size'
  | 'width'
  | 'height'
  | 'aspectRatio'
  | 'orientation'
> {
  const extension = normalizeExtension(stored.extension);

  return {
    originalName: stored.originalName,
    fileName: buildFileName(slug, extension),

    provider: stored.provider,
    key: stored.key,
    url: stored.url,
    folder: stored.folder,

    extension,
    mimeType: stored.mimeType,
    assetType,
    size: stored.size,

    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    aspectRatio: dimensions?.aspectRatio ?? null,
    orientation: dimensions?.orientation ?? null,
  };
}
