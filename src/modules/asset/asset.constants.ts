export const ASSET_TYPES = ['image', 'video', 'audio', 'document', 'archive', 'other'] as const;

export const ASSET_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;

export const ASSET_VISIBILITIES = ['public', 'private', 'unlisted'] as const;

export const ASSET_STATUSES = ['active', 'archived'] as const;

/** Lifecycle of the bytes themselves (large files are copied to storage in the background). */
export const ASSET_UPLOAD_STATUSES = ['processing', 'ready', 'failed'] as const;

export const ASSET_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'size'] as const;

export const ASSET_ERROR_CODES = {
  FILE_REQUIRED: 'ASSET_FILE_REQUIRED',
  ALT_REQUIRED: 'ASSET_ALT_REQUIRED',
  NOT_FOUND: 'ASSET_NOT_FOUND',
  SLUG_CONFLICT: 'ASSET_SLUG_CONFLICT',
  TYPE_MISMATCH: 'ASSET_TYPE_MISMATCH',
  VALIDATION_FAILED: 'ASSET_VALIDATION_FAILED',
} as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_BULK_DELETE = 100;

export const DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/rtf',
  'text/plain',
  'text/csv',
]);

export const ARCHIVE_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/vnd.rar',
]);
