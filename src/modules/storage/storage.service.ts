import { createReadStream } from 'node:fs';

import {
  DEFAULT_CACHE_CONTROL,
  DEFAULT_DISPOSITION,
  STORAGE_ERROR_CODES,
} from './storage.constants.js';
import { StorageError } from './storage.error.js';
import { getActiveStorageProvider, getStorageProvider } from './storage.registry.js';
import {
  assertValidKey,
  createObjectKey,
  decodeOriginalName,
  formatBytes,
  getFileExtension,
} from './storage.utils.js';
import type {
  DeleteFileResult,
  DeleteMultipleResult,
  StoragePath,
  StoredFile,
  UploadFileInput,
  UploadMultipleFilesInput,
} from './storage.types.js';

/** A key generated ahead of the upload (e.g. to persist a record first). */
export interface ReservedKey {
  key: string;
  folder: string;
  fileName: string;
}

/**
 * Provider-agnostic storage orchestration: validation, key naming and
 * rollback. All vendor specifics live behind the StorageProvider port.
 *
 * Files arrive either as in-memory buffers or, for very large uploads, as a
 * temp file that is streamed to the provider (never read fully into memory).
 */
class StorageService {
  /** Builds the object key for an upload without sending anything yet. */
  reserveKey(path: StoragePath, seoName: string, originalName: string): ReservedKey {
    if (!seoName?.trim()) {
      throw new StorageError(
        'SEO filename is required',
        STORAGE_ERROR_CODES.SEO_NAME_REQUIRED,
        400,
      );
    }

    return createObjectKey(path, seoName, originalName);
  }

  /** Uploads to the active provider. */
  async uploadFile(input: UploadFileInput & { reserved?: ReservedKey }): Promise<StoredFile> {
    const {
      file,
      seoName,
      path,
      reserved,
      disposition = DEFAULT_DISPOSITION,
      cacheControl = DEFAULT_CACHE_CONTROL,
    } = input;

    if (!file) {
      throw new StorageError('File is required', STORAGE_ERROR_CODES.FILE_REQUIRED, 400);
    }

    const hasBuffer = Boolean(file.buffer?.length);

    if (!hasBuffer && !file.path) {
      throw new StorageError('Uploaded file is empty', STORAGE_ERROR_CODES.FILE_BODY_MISSING, 400);
    }

    const provider = getActiveStorageProvider();

    const originalName = decodeOriginalName(file.originalname);
    const { key, folder, fileName } = reserved ?? this.reserveKey(path, seoName, originalName);
    const mimeType = file.mimetype || 'application/octet-stream';

    const body = hasBuffer ? file.buffer : createReadStream(file.path);

    const uploaded = await provider.upload({
      key,
      body,
      fileName,
      contentType: mimeType,
      contentLength: file.size,
      disposition,
      cacheControl,
    });

    return {
      provider: provider.name,
      key: uploaded.key,
      url: uploaded.url,
      fileName,
      originalName,
      mimeType,
      extension: getFileExtension(originalName),
      size: file.size,
      sizeFormatted: formatBytes(file.size),
      folder,
      etag: uploaded.etag,
      uploadedAt: new Date().toISOString(),
    };
  }

  /**
   * Sequential on purpose (avoids many large uploads competing for
   * bandwidth). If one fails, everything already uploaded is rolled back.
   */
  async uploadMultipleFiles(input: UploadMultipleFilesInput): Promise<StoredFile[]> {
    const { files, path, seoName, disposition, cacheControl } = input;

    if (!files || files.length === 0) {
      throw new StorageError(
        'At least one file is required',
        STORAGE_ERROR_CODES.FILES_REQUIRED,
        400,
      );
    }

    const uploadedFiles: StoredFile[] = [];

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];

        const generatedSeoName =
          typeof seoName === 'function' ? seoName(file, index) : `${seoName}-${index + 1}`;

        uploadedFiles.push(
          await this.uploadFile({
            file,
            path,
            seoName: generatedSeoName,
            disposition,
            cacheControl,
          }),
        );
      }

      return uploadedFiles;
    } catch (error) {
      await Promise.allSettled(
        uploadedFiles.map((stored) => this.deleteFile(stored.key, stored.provider)),
      );

      throw error;
    }
  }

  /**
   * Deletes from the provider that stored the object. Defaults to the active
   * provider when none is given.
   */
  async deleteFile(key: string, providerName?: string): Promise<DeleteFileResult> {
    if (!key?.trim()) {
      throw new StorageError('Object key is required', STORAGE_ERROR_CODES.KEY_REQUIRED, 400);
    }

    assertValidKey(key);

    await getStorageProvider(providerName).delete(key);

    return { key, deleted: true };
  }

  async deleteFiles(keys: string[], providerName?: string): Promise<DeleteMultipleResult> {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];

    if (uniqueKeys.length === 0) {
      return { deleted: [], failed: [] };
    }

    uniqueKeys.forEach(assertValidKey);

    return getStorageProvider(providerName).deleteMany(uniqueKeys);
  }

  /**
   * Uploads the new file first and removes the old object only afterwards, so
   * a failure never leaves the caller without a file.
   */
  async replaceFile(params: {
    oldKey: string;
    oldProvider?: string;
    newFile: UploadFileInput;
  }): Promise<StoredFile> {
    const { oldKey, oldProvider, newFile } = params;

    const uploaded = await this.uploadFile(newFile);

    try {
      await this.deleteFile(oldKey, oldProvider);

      return uploaded;
    } catch (error) {
      await this.deleteFile(uploaded.key, uploaded.provider).catch(() => undefined);

      throw new StorageError(
        'New file uploaded but existing file could not be replaced safely',
        STORAGE_ERROR_CODES.REPLACE_FAILED,
        500,
        error,
      );
    }
  }

  async exists(key: string, providerName?: string): Promise<boolean> {
    assertValidKey(key);

    return getStorageProvider(providerName).exists(key);
  }

  getPublicUrl(key: string, providerName?: string): string {
    return getStorageProvider(providerName).getPublicUrl(key);
  }
}

export const storageService = new StorageService();
