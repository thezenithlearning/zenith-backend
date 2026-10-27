import type { STORAGE_PROVIDERS } from './storage.constants.js';

export type StorageProviderName = (typeof STORAGE_PROVIDERS)[number];

export interface S3ProviderConfig {
  bucket: string;
  /** CDN base URL without a trailing slash. */
  publicUrl: string;
}

export interface StoragePath {
  /** Business area, e.g. blogs, courses, programs, pyq. */
  module: string;

  /** Entity slug or id, e.g. rbi-grade-b. */
  entity?: string;

  /** Logical grouping, e.g. banners, resources, thumbnails. */
  category?: string;
}

export interface UploadFileInput {
  file: Express.Multer.File;

  /** Human-readable name that becomes the slug part of the object key. */
  seoName: string;

  path: StoragePath;

  /** Defaults to inline. */
  disposition?: 'inline' | 'attachment';

  cacheControl?: string;
}

export interface UploadMultipleFilesInput {
  files: Express.Multer.File[];

  path: StoragePath;

  /** One base name (suffixed with the index) or a per-file generator. */
  seoName: string | ((file: Express.Multer.File, index: number) => string);

  disposition?: 'inline' | 'attachment';

  cacheControl?: string;
}

export interface StoredFile {
  /** Provider that holds the object; required to delete it later. */
  provider: StorageProviderName;

  key: string;

  url: string;

  fileName: string;

  originalName: string;

  mimeType: string;

  extension: string | null;

  size: number;

  sizeFormatted: string;

  folder: string;

  etag?: string;

  uploadedAt: string;
}

export interface DeleteFileResult {
  key: string;
  deleted: boolean;
}

export interface DeleteMultipleResult {
  deleted: string[];
  failed: Array<{
    key: string;
    code?: string;
    message?: string;
  }>;
}
