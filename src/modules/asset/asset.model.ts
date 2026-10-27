import mongoose, { Schema, type Model } from 'mongoose';

import {
  ASSET_ORIENTATIONS,
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_UPLOAD_STATUSES,
  ASSET_VISIBILITIES,
} from './asset.constants.js';
import type { Asset } from './asset.types.js';

const assetSchema = new Schema<Asset>(
  {
    originalName: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },

    provider: { type: String, required: true, lowercase: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    folder: { type: String, required: true, trim: true },

    extension: { type: String, default: null, lowercase: true },
    mimeType: { type: String, required: true, lowercase: true },
    assetType: { type: String, enum: ASSET_TYPES, required: true },
    size: { type: Number, required: true, min: 0 },

    width: { type: Number, default: null },
    height: { type: Number, default: null },
    aspectRatio: { type: Number, default: null },
    orientation: { type: String, enum: ASSET_ORIENTATIONS, default: null },

    alt: { type: String, default: '', trim: true },
    title: { type: String, default: '', trim: true },
    caption: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    seoTitle: { type: String, default: '', trim: true },
    seoDescription: { type: String, default: '', trim: true },
    keywords: { type: [String], default: [] },
    tags: { type: [String], default: [] },

    indexable: { type: Boolean, default: true },
    searchable: { type: Boolean, default: true },
    visibility: { type: String, enum: ASSET_VISIBILITIES, default: 'public' },
    status: { type: String, enum: ASSET_STATUSES, default: 'active' },

    uploadStatus: { type: String, enum: ASSET_UPLOAD_STATUSES, default: 'ready' },
    errorMessage: { type: String },

    duration: { type: Number, default: null },
    pages: { type: Number, default: null },

    legacyFileId: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

assetSchema.index({ slug: 1 }, { unique: true });
assetSchema.index({ key: 1 }, { unique: true });
assetSchema.index({ legacyFileId: 1 }, { unique: true, sparse: true });
assetSchema.index({ uploadStatus: 1 });
assetSchema.index({ folder: 1, createdAt: -1 });
assetSchema.index({ assetType: 1, status: 1, createdAt: -1 });
assetSchema.index({ tags: 1 });
assetSchema.index(
  {
    title: 'text',
    alt: 'text',
    caption: 'text',
    originalName: 'text',
    keywords: 'text',
    tags: 'text',
  },
  {
    name: 'asset_text_search',
    weights: { title: 10, keywords: 8, tags: 6, alt: 4, caption: 2 },
  },
);

export const AssetModel: Model<Asset> =
  (mongoose.models.Asset as Model<Asset> | undefined) ??
  mongoose.model<Asset>('Asset', assetSchema);
