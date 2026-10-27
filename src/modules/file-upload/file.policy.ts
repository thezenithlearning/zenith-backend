import path from 'node:path';
import { AppError } from '../../errors/AppError.js';

export const MAX_MANAGED_FILE_SIZE = 1024 * 1024 * 1024;
export const UPLOAD_PART_SIZE = 8 * 1024 * 1024;

const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
};

export const resolveUploadMimeType = (name: string, mimeType?: string): string => {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  return VIDEO_MIME_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
};

export const assertManagedFileSize = (size: number): void => {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new AppError('Choose a non-empty file to upload.', 400, 'BAD_REQUEST');
  }
  if (size > MAX_MANAGED_FILE_SIZE) {
    throw new AppError('Files, including videos, must be 1 GB or smaller.', 413, 'BAD_REQUEST');
  }
};

export const expectedPartSize = (size: number, partNumber: number): number => {
  assertManagedFileSize(size);
  if (
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > Math.ceil(size / UPLOAD_PART_SIZE)
  ) {
    throw new AppError('Invalid upload part number.', 400, 'BAD_REQUEST');
  }
  return Math.min(UPLOAD_PART_SIZE, size - (partNumber - 1) * UPLOAD_PART_SIZE);
};

export interface UploadedPart {
  partNumber: number;
  etag: string;
  checksumCRC32: string;
  size: number;
}

export const validateUploadedParts = (size: number, parts: UploadedPart[]): UploadedPart[] => {
  assertManagedFileSize(size);
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  if (
    ordered.length !== Math.ceil(size / UPLOAD_PART_SIZE) ||
    ordered.some(
      (part, index) =>
        part.partNumber !== index + 1 ||
        !part.etag ||
        !part.checksumCRC32 ||
        part.size !== expectedPartSize(size, index + 1),
    )
  ) {
    throw new AppError(
      'Some upload parts are missing or incomplete. Please retry the upload.',
      409,
      'BAD_REQUEST',
    );
  }
  return ordered;
};
