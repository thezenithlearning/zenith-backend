import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import s3 from '../../../config/s3.config.js';
import { logger } from '../../../config/logger.js';
import { S3_DELETE_BATCH_SIZE, STORAGE_ERROR_CODES } from '../storage.constants.js';
import { StorageError } from '../storage.error.js';
import type { DeleteMultipleResult, S3ProviderConfig } from '../storage.types.js';
import type {
  ProviderUploadInput,
  ProviderUploadResult,
  StorageProvider,
} from './storage-provider.interface.js';

const PART_SIZE = 10 * 1024 * 1024;
const QUEUE_SIZE = 4;

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;

  constructor(private readonly config: S3ProviderConfig) {}

  async upload(input: ProviderUploadInput): Promise<ProviderUploadResult> {
    try {
      const uploader = new Upload({
        client: s3,
        params: {
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ...(input.contentLength !== undefined ? { ContentLength: input.contentLength } : {}),
          // RFC 6266: ASCII fallback plus the UTF-8 form.
          ContentDisposition: `${input.disposition}; filename="${asciiFileName(
            input.fileName,
          )}"; filename*=UTF-8''${encodeURIComponent(input.fileName)}`,
          CacheControl: input.cacheControl,
          ServerSideEncryption: 'AES256',
        },
        queueSize: QUEUE_SIZE,
        partSize: PART_SIZE,
        leavePartsOnError: false,
      });

      const result = await uploader.done();

      return {
        key: input.key,
        url: this.getPublicUrl(input.key),
        etag: result.ETag?.replace(/"/g, ''),
      };
    } catch (error) {
      throw this.toStorageError(error, 'File upload failed', STORAGE_ERROR_CODES.UPLOAD_FAILED);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (error) {
      throw this.toStorageError(error, 'File deletion failed', STORAGE_ERROR_CODES.DELETE_FAILED);
    }
  }

  async deleteMany(keys: string[]): Promise<DeleteMultipleResult> {
    const deleted: string[] = [];
    const failed: DeleteMultipleResult['failed'] = [];

    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH_SIZE) {
      const chunk = keys.slice(i, i + S3_DELETE_BATCH_SIZE);

      try {
        const response = await s3.send(
          new DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: { Quiet: false, Objects: chunk.map((Key) => ({ Key })) },
          }),
        );

        for (const item of response.Deleted ?? []) {
          if (item.Key) deleted.push(item.Key);
        }

        for (const item of response.Errors ?? []) {
          failed.push({ key: item.Key ?? 'unknown', code: item.Code, message: item.Message });
        }
      } catch (error) {
        // A whole-batch failure is reported per key so callers keep the
        // records they could not delete instead of losing the entire call.
        const normalized = this.toStorageError(
          error,
          'Multiple file deletion failed',
          STORAGE_ERROR_CODES.DELETE_FAILED,
        );

        for (const key of chunk) {
          failed.push({ key, code: normalized.code, message: normalized.message });
        }
      }
    }

    return { deleted, failed };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));

      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata?.httpStatusCode === 404) {
        return false;
      }

      throw this.toStorageError(
        error,
        'Could not check the file in storage',
        STORAGE_ERROR_CODES.UPLOAD_FAILED,
      );
    }
  }

  getPublicUrl(key: string): string {
    const encoded = key.split('/').map(encodeURIComponent).join('/');

    return `${this.config.publicUrl}/${encoded}`;
  }

  private toStorageError(
    error: unknown,
    fallbackMessage: string,
    fallbackCode: string,
  ): StorageError {
    logger.error({ err: error }, 'S3 storage error');

    if (error instanceof StorageError) {
      return error;
    }

    if (error instanceof S3ServiceException) {
      return new StorageError(
        error.message || fallbackMessage,
        error.name || fallbackCode,
        error.$metadata?.httpStatusCode ?? 500,
        {
          requestId: error.$metadata?.requestId,
          httpStatusCode: error.$metadata?.httpStatusCode,
        },
      );
    }

    return new StorageError(fallbackMessage, fallbackCode, 500);
  }
}

function asciiFileName(fileName: string): string {
  return fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}
