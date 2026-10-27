import type { AssetDocument } from '../asset/asset.types.js';

/**
 * API shape of a file in the File Manager. It keeps the field names the
 * dashboard already uses (altText, storageKey, publicId, resourceType…) and
 * adds the richer library fields (slug, tags, SEO, dimensions…).
 */
export interface FileDto {
  _id: string;
  originalName: string;
  fileName: string;
  slug: string;

  /** Upload lifecycle: 'processing' while the server copies a file to storage. */
  status: 'processing' | 'ready' | 'failed';
  errorMessage?: string;

  title: string;
  description: string;
  altText: string;
  caption: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  tags: string[];

  /** Object key; the public `url` is derived from it by the CDN base URL. */
  storageKey: string;
  publicId: string;
  path: string;
  url: string;

  mimeType: string;
  size: number;
  folder: string;
  assetType: string;
  resourceType: 'image' | 'video' | 'raw';
  format: string;

  width?: number;
  height?: number;
  duration?: number;
  pages?: number;

  visibility: string;
  assetStatus: string;

  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const toFileDto = (asset: AssetDocument): FileDto => ({
  _id: String(asset._id),
  originalName: asset.originalName,
  fileName: asset.fileName,
  slug: asset.slug,

  status: asset.uploadStatus ?? 'ready',
  ...(asset.errorMessage ? { errorMessage: asset.errorMessage } : {}),

  title: asset.title ?? '',
  description: asset.description ?? '',
  altText: asset.alt ?? '',
  caption: asset.caption ?? '',
  seoTitle: asset.seoTitle ?? '',
  seoDescription: asset.seoDescription ?? '',
  keywords: asset.keywords ?? [],
  tags: asset.tags ?? [],

  storageKey: asset.key,
  publicId: asset.key,
  path: `/${asset.key}`,
  url: asset.url,

  mimeType: asset.mimeType,
  size: asset.size,
  folder: asset.folder,
  assetType: asset.assetType,
  resourceType:
    asset.assetType === 'image' ? 'image' : asset.assetType === 'video' ? 'video' : 'raw',
  format: asset.extension ?? '',

  ...(asset.width ? { width: asset.width } : {}),
  ...(asset.height ? { height: asset.height } : {}),
  ...(asset.duration ? { duration: asset.duration } : {}),
  ...(asset.pages ? { pages: asset.pages } : {}),

  visibility: asset.visibility,
  assetStatus: asset.status,

  uploadedAt: asset.createdAt,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
});
