import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Router, type NextFunction, type Response } from 'express';
import { createReadStream } from 'node:fs';
import { Types } from 'mongoose';
import path from 'node:path';
import { z } from 'zod';

import s3 from '../../config/s3.config.js';
import { ENV } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../errors/AppError.js';
import { protect, authorize, type AuthRequest } from '../../middlewares/auth.middleware.js';
import { removeTempFile } from '../../utils/fileUpload.js';
import { DEFAULT_CACHE_CONTROL } from '../storage/storage.constants.js';
import { storageService } from '../storage/storage.service.js';
import { getFileExtension } from '../storage/storage.utils.js';
import { assetService } from '../asset/asset.service.js';
import { AssetModel } from '../asset/asset.model.js';
import { toFileDto } from './file.dto.js';
import { UploadSessionModel } from './file-upload-session.model.js';
import { managedPartUpload } from './file.upload.js';
import {
  assertManagedFileSize,
  expectedPartSize,
  resolveUploadMimeType,
  UPLOAD_PART_SIZE,
  validateUploadedParts,
} from './file.policy.js';

const router = Router();
const UPLOAD_MODULE = 'uploads';
const startSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  size: z.number(),
  mimeType: z
    .string()
    .max(255)
    .regex(/^[\w.+-]+\/[\w.+-]+$|^$/)
    .optional(),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  altText: z.string().trim().max(300).optional(),
  caption: z.string().trim().max(500).optional(),
});

const sessionFor = async (req: AuthRequest) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) {
    throw new AppError('Invalid upload session.', 400, 'BAD_REQUEST');
  }
  const session = await UploadSessionModel.findOne({
    _id: req.params.id,
    owner: req.user?.userId,
    expiresAt: { $gt: new Date() },
  });
  if (!session)
    throw new AppError(
      'Upload session expired. Please start the upload again.',
      404,
      'BAD_REQUEST',
    );
  return session;
};

router.use(protect, authorize('admin'));

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  let uploadId: string | undefined;
  let storageKey: string | undefined;
  try {
    const { originalName, size, mimeType, ...metadata } = startSchema.parse(req.body);
    assertManagedFileSize(size);
    const id = new Types.ObjectId();
    storageKey = storageService.reserveKey(
      { module: UPLOAD_MODULE },
      metadata.title || path.basename(originalName, path.extname(originalName)),
      originalName,
    ).key;
    const contentType = resolveUploadMimeType(originalName, mimeType);
    const result = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: ENV.AWS_BUCKET_NAME,
        Key: storageKey,
        ContentType: contentType,
        ContentDisposition: 'inline',
        CacheControl: DEFAULT_CACHE_CONTROL,
        ServerSideEncryption: 'AES256',
        ChecksumAlgorithm: 'CRC32',
        Metadata: { 'upload-session': String(id) },
      }),
    );
    uploadId = result.UploadId;
    if (!uploadId) throw new AppError('Could not start the storage upload.', 503, 'INTERNAL');

    await UploadSessionModel.create({
      _id: id,
      owner: req.user!.userId,
      originalName,
      size,
      mimeType: contentType,
      storageKey,
      uploadId,
      metadata,
      parts: [],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    res.status(201).json({ success: true, data: { id: String(id), partSize: UPLOAD_PART_SIZE } });
  } catch (error) {
    if (uploadId && storageKey) {
      await s3
        .send(
          new AbortMultipartUploadCommand({
            Bucket: ENV.AWS_BUCKET_NAME,
            Key: storageKey,
            UploadId: uploadId,
          }),
        )
        .catch((cleanupError) =>
          logger.warn({ err: cleanupError }, 'Could not abort unregistered upload'),
        );
    }
    next(error);
  }
});

router.put(
  '/:id/parts/:partNumber',
  managedPartUpload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const session = await sessionFor(req);
      const partNumber = Number(req.params.partNumber);
      const size = expectedPartSize(session.size, partNumber);
      if (req.file && req.file.size > UPLOAD_PART_SIZE) {
        throw new AppError('Upload parts must be 8 MB or smaller.', 413, 'BAD_REQUEST');
      }
      if (!req.file || req.file.size !== size) {
        throw new AppError(
          'The upload part is incomplete or has an invalid size.',
          400,
          'BAD_REQUEST',
        );
      }

      const stream = createReadStream(req.file.path);
      let etag: string | undefined;
      let checksumCRC32: string | undefined;
      try {
        const result = await s3.send(
          new UploadPartCommand({
            Bucket: ENV.AWS_BUCKET_NAME,
            Key: session.storageKey,
            UploadId: session.uploadId,
            PartNumber: partNumber,
            Body: stream,
            ContentLength: size,
            ChecksumAlgorithm: 'CRC32',
          }),
        );
        etag = result.ETag;
        checksumCRC32 = result.ChecksumCRC32;
      } finally {
        stream.destroy();
      }
      if (!etag || !checksumCRC32)
        throw new AppError('Storage did not confirm this upload part.', 503, 'INTERNAL');

      // Replace the receipt for a retry; never count the same bytes twice.
      session.parts = session.parts.filter((part) => part.partNumber !== partNumber);
      session.parts.push({ partNumber, etag, checksumCRC32, size });
      await session.save();
      res.json({ success: true, data: { partNumber } });
    } catch (error) {
      next(error);
    } finally {
      await removeTempFile(req.file);
    }
  },
);

router.post('/:id/complete', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const session = await sessionFor(req);
    const existing = await AssetModel.findById(session._id).lean();
    if (existing) {
      res.json({ success: true, data: toFileDto(existing) });
      return;
    }
    const parts = validateUploadedParts(session.size, session.parts);
    try {
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: ENV.AWS_BUCKET_NAME,
          Key: session.storageKey,
          UploadId: session.uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
              ChecksumCRC32: part.checksumCRC32,
            })),
          },
        }),
      );
    } catch (error) {
      // A lost response or DB failure after completion must not upload a second copy.
      if (!(error instanceof Error) || error.name !== 'NoSuchUpload') throw error;
    }
    const stored = await s3.send(
      new HeadObjectCommand({ Bucket: ENV.AWS_BUCKET_NAME, Key: session.storageKey }),
    );
    if (
      stored.ContentLength !== session.size ||
      stored.Metadata?.['upload-session'] !== String(session._id)
    ) {
      throw new AppError('The stored file could not be verified. Please retry.', 502, 'INTERNAL');
    }

    const folder = session.storageKey.split('/').slice(0, -1).join('/');
    const file = await assetService.registerStoredObject({
      id: String(session._id),
      stored: {
        provider: 's3',
        key: session.storageKey,
        url: storageService.getPublicUrl(session.storageKey),
        fileName: path.basename(session.storageKey),
        originalName: session.originalName,
        mimeType: session.mimeType,
        extension: getFileExtension(session.originalName),
        size: session.size,
        folder: folder || UPLOAD_MODULE,
      },
      metadata: {
        title: session.metadata.title,
        description: session.metadata.description,
        alt: session.metadata.altText,
        caption: session.metadata.caption,
      },
      uploadStatus: 'ready',
    });
    // Keep the receipt until expiry so a repeated completion is idempotent.
    res.json({ success: true, message: 'File uploaded successfully.', data: toFileDto(file) });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const session = await sessionFor(req);
    await s3
      .send(
        new AbortMultipartUploadCommand({
          Bucket: ENV.AWS_BUCKET_NAME,
          Key: session.storageKey,
          UploadId: session.uploadId,
        }),
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== 'NoSuchUpload') throw error;
      });
    await session.deleteOne();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
