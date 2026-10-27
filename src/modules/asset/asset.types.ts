import type { Types } from 'mongoose';
import type {
  ASSET_ORIENTATIONS,
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_UPLOAD_STATUSES,
  ASSET_VISIBILITIES,
} from './asset.constants.js';

export type AssetType = (typeof ASSET_TYPES)[number];
export type AssetOrientation = (typeof ASSET_ORIENTATIONS)[number];
export type AssetVisibility = (typeof ASSET_VISIBILITIES)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type AssetUploadStatus = (typeof ASSET_UPLOAD_STATUSES)[number];

export interface Asset {
  originalName: string;
  fileName: string;
  slug: string;

  // Storage
  provider: string;
  key: string;
  url: string;
  folder: string;

  // File
  extension: string | null;
  mimeType: string;
  assetType: AssetType;
  size: number;

  // Image dimensions (images only)
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  orientation: AssetOrientation | null;

  // Descriptive / SEO
  alt: string;
  title: string;
  caption: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  tags: string[];

  // Discoverability
  indexable: boolean;
  searchable: boolean;
  visibility: AssetVisibility;
  status: AssetStatus;

  // Upload lifecycle
  uploadStatus: AssetUploadStatus;
  errorMessage?: string;

  // Media details (video / PDF)
  duration?: number | null;
  pages?: number | null;

  /** `_id` of the record in the old `files` collection this asset was migrated from. */
  legacyFileId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface AssetDocument extends Asset {
  _id: Types.ObjectId;
}

export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  orientation: AssetOrientation;
}

export interface AssetMetadataInput {
  slug?: string;
  alt?: string;
  title?: string;
  caption?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  keywords?: string[];
  tags?: string[];
  indexable?: boolean;
  searchable?: boolean;
  visibility?: AssetVisibility;
  status?: AssetStatus;
}

export interface CreateAssetInput extends AssetMetadataInput {
  module: string;
  entity?: string;
  category?: string;
}

export type UpdateAssetInput = AssetMetadataInput;

export interface ListAssetsQuery {
  page: number;
  limit: number;
  search?: string;
  assetType?: AssetType;
  folder?: string;
  mimeType?: string;
  tag?: string;
  visibility?: AssetVisibility;
  status?: AssetStatus;
  sortBy: 'createdAt' | 'updatedAt' | 'title' | 'size';
  sortOrder: 'asc' | 'desc';
}

export interface PaginatedAssets {
  items: AssetDocument[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface BulkDeleteAssetsResult {
  deleted: string[];
  notFound: string[];
  failed: Array<{
    id: string;
    key: string;
    code?: string;
    message?: string;
  }>;
}
