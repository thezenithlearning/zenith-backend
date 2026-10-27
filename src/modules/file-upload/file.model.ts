// LEGACY: the File Manager now stores its records in the `assets` collection
// (see modules/asset). This model only exists so scripts/migrateAssets.ts can
// read the old `files` collection. Do not use it in application code.
import mongoose, { Schema, Document } from 'mongoose';

export interface IFile extends Document {
  originalName: string;
  /** 'processing' while the server copies the file to storage in the background. */
  status?: 'processing' | 'ready' | 'failed';
  errorMessage?: string;
  /** Final readable file name inside the storage key, e.g. banner-60cac42c.webp */
  fileName?: string;
  title?: string;
  description?: string;
  altText?: string;
  caption?: string;
  /** Relative CDN path (new records), e.g. /zenith/uploads/uuid.webp */
  path?: string;
  /** Legacy full URL (pre-S3 records). */
  url?: string;
  publicId: string;
  storageKey?: string;
  mimeType: string;
  size: number;
  folder: string;

  resourceType: string;
  format: string;
  uploadedAt: Date;
}

const fileSchema = new Schema<IFile>(
  {
    originalName: {
      type: String,
      required: true,
    },

    fileName: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: ['processing', 'ready', 'failed'],
      default: 'ready',
    },

    errorMessage: {
      type: String,
    },

    title: {
      type: String,
      default: '',
      trim: true,
    },

    description: {
      type: String,
      default: '',
      trim: true,
    },

    altText: {
      type: String,
      default: '',
      trim: true,
    },

    caption: {
      type: String,
      default: '',
      trim: true,
    },

    path: {
      type: String,
    },

    // Legacy full URL (pre-S3 records).
    url: {
      type: String,
    },

    publicId: {
      type: String,
      required: true,
      unique: true,
    },

    storageKey: {
      type: String,
      trim: true,
      index: true,
    },

    mimeType: {
      type: String,
      required: true,
    },

    size: {
      type: Number,
      required: true,
    },

    folder: {
      type: String,
      default: 'uploads',
    },

    resourceType: {
      type: String,
      required: true,
    },

    format: {
      type: String,
      required: true,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

export const FileModel = mongoose.model<IFile>('File', fileSchema);
