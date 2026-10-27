import mongoose, { Schema } from 'mongoose';
import type { UploadedPart } from './file.policy.js';

export interface IUploadSession {
  owner: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadId: string;
  metadata: { title?: string; description?: string; altText?: string; caption?: string };
  parts: UploadedPart[];
  expiresAt: Date;
}

const sessionSchema = new Schema<IUploadSession>(
  {
    owner: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    uploadId: { type: String, required: true },
    metadata: {
      title: String,
      description: String,
      altText: String,
      caption: String,
    },
    parts: [{ _id: false, partNumber: Number, etag: String, checksumCRC32: String, size: Number }],
    // S3's AbortIncompleteMultipartUpload lifecycle rule cleans abandoned parts.
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

export const UploadSessionModel = mongoose.model<IUploadSession>(
  'FileUploadSession',
  sessionSchema,
);
