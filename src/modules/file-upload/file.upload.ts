import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { AppError } from '../../errors/AppError.js';
import { MAX_MANAGED_FILE_SIZE, UPLOAD_PART_SIZE, resolveUploadMimeType } from './file.policy.js';

export { MAX_MANAGED_FILE_SIZE } from './file.policy.js';

/**
 * Files are spooled to the OS temp dir rather than held in memory so a 1 GB
 * upload does not exhaust RAM; they are streamed to S3 and removed afterwards.
 */
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, os.tmpdir()),
  filename: (_req, _file, callback) =>
    callback(null, `zenith-upload-${Date.now()}-${randomBytes(6).toString('hex')}`),
});

export const managedUpload = multer({
  storage,
  // Busboy emits LIMIT_FILE_SIZE at the limit itself; allow the exact 1 GB boundary.
  limits: { fileSize: MAX_MANAGED_FILE_SIZE + 1, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!file?.originalname || !path.basename(file.originalname)) {
      callback(new AppError('Invalid file', 400, 'BAD_REQUEST'));
      return;
    }
    file.mimetype = resolveUploadMimeType(file.originalname, file.mimetype);
    callback(null, true);
  },
});

/** Bound each request and its disk use, even when the complete video is 1 GB. */
export const managedPartUpload = multer({
  storage,
  limits: { fileSize: UPLOAD_PART_SIZE + 1, files: 1, fields: 0 },
});
