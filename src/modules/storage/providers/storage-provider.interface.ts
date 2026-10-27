import type { Readable } from 'node:stream';

import type { DeleteMultipleResult, StorageProviderName } from '../storage.types.js';

export interface ProviderUploadInput {
  /** Provider-neutral object key, e.g. "blogs/banners/slug--uuid.webp". */
  key: string;

  /** File contents: an in-memory buffer, or a stream for large disk-backed files. */
  body: Buffer | Readable;

  fileName: string;
  contentType: string;
  contentLength?: number;
  disposition: 'inline' | 'attachment';
  cacheControl: string;
}

export interface ProviderUploadResult {
  /**
   * Identifier for every later delete / URL lookup. Most providers return the
   * requested key unchanged.
   */
  key: string;

  /** Public URL the object is served from. */
  url: string;

  etag?: string;
}

/**
 * Port every storage backend implements. Implementations must:
 *  - throw StorageError (never raw SDK errors),
 *  - treat deleting a missing object as success (idempotent).
 */
export interface StorageProvider {
  readonly name: StorageProviderName;

  upload(input: ProviderUploadInput): Promise<ProviderUploadResult>;

  delete(key: string): Promise<void>;

  /** Never throws for per-key failures; reports them in `failed`. */
  deleteMany(keys: string[]): Promise<DeleteMultipleResult>;

  /** True when the object exists in storage. */
  exists(key: string): Promise<boolean>;

  getPublicUrl(key: string): string;
}
