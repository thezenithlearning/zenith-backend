/**
 * Registered storage providers. Adding a provider means:
 *   1. add its name here,
 *   2. add a class in ./providers implementing StorageProvider,
 *   3. register a factory in storage.registry.ts.
 * Nothing outside the storage module needs to change.
 */
export const STORAGE_PROVIDERS = ['s3'] as const;

/** Object keys are unique and never overwritten, so they can be cached forever. */
export const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const DEFAULT_DISPOSITION = 'inline';

export const STORAGE_ERROR_CODES = {
  FILE_REQUIRED: 'FILE_REQUIRED',
  FILES_REQUIRED: 'FILES_REQUIRED',
  SEO_NAME_REQUIRED: 'SEO_NAME_REQUIRED',
  FILE_BODY_MISSING: 'FILE_BODY_MISSING',
  KEY_REQUIRED: 'KEY_REQUIRED',
  INVALID_KEY: 'INVALID_KEY',
  INVALID_PATH: 'INVALID_STORAGE_PATH',
  UNKNOWN_PROVIDER: 'UNKNOWN_STORAGE_PROVIDER',
  UPLOAD_FAILED: 'STORAGE_UPLOAD_FAILED',
  DELETE_FAILED: 'STORAGE_DELETE_FAILED',
  REPLACE_FAILED: 'FILE_REPLACEMENT_FAILED',
} as const;

export const S3_DELETE_BATCH_SIZE = 1000;
