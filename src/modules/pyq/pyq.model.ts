import mongoose, { Schema, type Document, type Model } from 'mongoose';
import type { IUploadedFile } from '../../types/uploaded-file.type.js';
import { publishSchemaFields, type PublishStatus } from '../../utils/publishing.js';

export interface IPyq extends Document {
  title: string;
  slug: string;
  description: string;
  category: mongoose.Types.ObjectId;
  examName: string;
  year?: number;
  pdf: IUploadedFile;
  keywords: string[];
  seoTitle: string;
  seoDescription: string;
  accessCount: number;
  status: PublishStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PdfSchema = new Schema<IUploadedFile>(
  {
    url: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    size: { type: Number, required: true, min: 0 },
    extension: { type: String, required: true, trim: true, lowercase: true },
    uploadedAt: { type: Date, required: true, default: Date.now },
    etag: { type: String, trim: true },
    pages: { type: Number, min: 0 },
  },
  { _id: false },
);

const PyqSchema = new Schema<IPyq>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '', trim: true, maxlength: 20000 },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'CourseCategory',
      required: true,
      index: true,
    },
    examName: { type: String, default: '', trim: true, maxlength: 150 },
    year: { type: Number, min: 1950, max: 2100 },
    pdf: { type: PdfSchema, required: true },
    keywords: { type: [String], default: [] },
    seoTitle: { type: String, default: '', trim: true, maxlength: 200 },
    seoDescription: { type: String, default: '', trim: true, maxlength: 400 },
    accessCount: { type: Number, default: 0 },
    ...publishSchemaFields,
  },
  { timestamps: true, versionKey: false },
);

PyqSchema.index({ status: 1, category: 1, year: -1, publishedAt: -1 });

export const Pyq: Model<IPyq> =
  (mongoose.models.Pyq as Model<IPyq> | undefined) ?? mongoose.model<IPyq>('Pyq', PyqSchema);
