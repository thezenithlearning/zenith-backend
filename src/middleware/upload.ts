import multer from 'multer';
import path from 'node:path';
import { AppError } from '../errors/AppError.js';
import { ENV } from '../config/env.js';

const storage = multer.memoryStorage();

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_FILES_PER_REQUEST = 20;

/** Dedicated cap for video uploads, independent of MAX_FILE_SIZE. */
export const MAX_VIDEO_FILE_SIZE =
  (ENV.MAX_VIDEO_UPLOAD_MB ?? 50) * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const BLOG_RESOURCE_MIME_TYPES = new Set([
  ...IMAGE_MIME_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const BLOG_RESOURCE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mkv',
]);

const reject = (
  callback: multer.FileFilterCallback,
  message: string,
): void => {
  callback(new AppError(message, 400, 'BAD_REQUEST'));
};

const genericFileFilter: multer.Options['fileFilter'] = (
  _req,
  file,
  callback,
) => {
  if (!file?.originalname) {
    reject(callback, 'Invalid file');
    return;
  }

  callback(null, true);
};

const courseFileFilter: multer.Options['fileFilter'] = (
  _req,
  file,
  callback,
) => {
  try {
    if (!file?.originalname) {
      reject(callback, 'Invalid file');
      return;
    }

    const allowed =
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('image/');

    if (!allowed) {
      reject(
        callback,
        `Unsupported file type "${file.mimetype}". Course uploads support images and PDF files only.`,
      );
      return;
    }

    callback(null, true);
  } catch (error) {
    callback(error as Error);
  }
};

const blogFileFilter: multer.Options['fileFilter'] = (
  _req,
  file,
  callback,
) => {
  try {
    if (!file?.originalname) {
      reject(callback, 'Invalid file');
      return;
    }

    if (file.fieldname === 'banner') {
      if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
        reject(
          callback,
          'Blog banner must be a JPG, PNG, WEBP, GIF, or AVIF image.',
        );
        return;
      }

      callback(null, true);
      return;
    }

    if (file.fieldname === 'resources') {
      const extension = path.extname(file.originalname).toLowerCase();
      const isVideo = file.mimetype.startsWith('video/');
      const allowed =
        isVideo ||
        BLOG_RESOURCE_MIME_TYPES.has(file.mimetype) ||
        BLOG_RESOURCE_EXTENSIONS.has(extension);

      if (!allowed) {
        reject(
          callback,
          `Unsupported blog resource "${file.originalname}". Allowed types: images, videos, PDF, DOC, DOCX, and TXT.`,
        );
        return;
      }

      callback(null, true);
      return;
    }

    reject(callback, `Unexpected upload field "${file.fieldname}".`);
  } catch (error) {
    callback(error as Error);
  }
};

const createMemoryUpload = (
  fileFilter: multer.Options['fileFilter'],
): multer.Multer =>
  multer({
    storage,
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: MAX_FILES_PER_REQUEST,
    },
    fileFilter,
  });

/**
 * Course upload middleware.
 *
 * Course resources are restricted to images and PDFs because the course
 * resource model only supports the `image` and `pdf` resource types.
 */
export const courseUpload = createMemoryUpload(courseFileFilter);

/** Generic in-memory intake used before a file is persisted to S3. */
export const upload = createMemoryUpload(genericFileFilter);

/**
 * Blog upload middleware.
 *
 * Banner: images only.
 * Resources: images, videos, PDF, DOC, DOCX, and TXT.
 */
export const blogUpload = createMemoryUpload(blogFileFilter);

/**
 * Rejects a video file once multer has buffered it in memory if it exceeds
 * MAX_VIDEO_FILE_SIZE. Multer's per-instance `limits.fileSize` can't apply a
 * lower cap to only one mimetype, so this is checked after upload parsing
 * and before the file is pushed to S3.
 */
export const assertVideoSizeWithinLimit = (
  file: Express.Multer.File | undefined,
): void => {
  if (!file || !file.mimetype.startsWith('video/')) return;

  if (file.size > MAX_VIDEO_FILE_SIZE) {
    const maxMb = Math.round(MAX_VIDEO_FILE_SIZE / (1024 * 1024));
    throw new AppError(
      `Video files must be ${maxMb}MB or smaller.`,
      400,
      'BAD_REQUEST',
    );
  }
};
