import { z } from 'zod';

import {
  ASSET_SORT_FIELDS,
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  DEFAULT_PAGE_SIZE,
  MAX_BULK_DELETE,
  MAX_PAGE_SIZE,
} from './asset.constants.js';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * Multipart form fields arrive as strings, so lists may be sent as
 * a JSON array ('["a","b"]'), a comma separated string ("a,b"),
 * or repeated fields.
 */
function parseList(value: unknown): unknown {
  if (value === undefined || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }

    return trimmed.split(',');
  }

  return value;
}

const stringList = z.preprocess(
  parseList,
  z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .transform((items) => [...new Set(items.map((item) => item.toLowerCase()))])
    .optional(),
);

const booleanLike = z.union([z.boolean(), z.stringbool()]);

const objectId = z.string().regex(OBJECT_ID_PATTERN, 'Must be a valid 24 character id');

const metadataShape = {
  slug: z.string().trim().min(1).max(200).optional(),
  alt: z.string().trim().max(300).optional(),
  title: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(160).optional(),
  keywords: stringList,
  tags: stringList,
  indexable: booleanLike.optional(),
  searchable: booleanLike.optional(),
  visibility: z.enum(ASSET_VISIBILITIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
};

/** Metadata fields without the "at least one" rule (multipart bodies may also carry a file). */
export const assetMetadataSchema = z.object(metadataShape);

export const updateAssetSchema = z
  .strictObject(metadataShape)
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const listAssetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().min(1).max(200).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  folder: z.string().trim().min(1).max(300).optional(),
  mimeType: z.string().trim().min(1).max(100).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  visibility: z.enum(ASSET_VISIBILITIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  sortBy: z.enum(ASSET_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const assetIdParamSchema = z.object({ id: objectId });

export const bulkDeleteAssetsSchema = z.object({
  ids: z
    .array(objectId)
    .min(1)
    .max(MAX_BULK_DELETE)
    .transform((ids) => [...new Set(ids)]),
});
