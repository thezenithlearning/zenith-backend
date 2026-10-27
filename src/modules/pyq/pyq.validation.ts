import { z } from 'zod';
import { PUBLISH_STATUSES, publicLeadSchema, publishInputShape } from '../../utils/publishing.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Multipart forms send everything as strings – treat blanks as "not provided".
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const keywordsSchema = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  if (v.trim().startsWith('[')) {
    try {
      return JSON.parse(v);
    } catch {
      /* fall through to comma split */
    }
  }
  return v.split(',');
}, z.array(z.string().trim().min(1).max(60)).max(30).optional());

const slugSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .toLowerCase()
    .max(100)
    .regex(slugPattern, 'Slug may contain lowercase letters, numbers and hyphens only')
    .optional(),
);

const yearSchema = z.preprocess(blankToUndefined, z.coerce.number().int().min(1950).max(2100).optional());

export const createPyqSchema = z.object({
  title: z.string().trim().min(3, 'Title is required').max(200),
  slug: slugSchema,
  description: z.string().trim().max(20000).default(''),
  category: objectId,
  examName: z.string().trim().max(150).default(''),
  year: yearSchema,
  keywords: keywordsSchema,
  seoTitle: z.string().trim().max(200).default(''),
  seoDescription: z.string().trim().max(400).default(''),
  ...publishInputShape,
});

export const updatePyqSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  slug: slugSchema,
  description: z.string().trim().max(20000).optional(),
  category: objectId.optional(),
  examName: z.string().trim().max(150).optional(),
  year: yearSchema,
  keywords: keywordsSchema,
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
  status: z.enum(PUBLISH_STATUSES).optional(),
  publishAt: publishInputShape.publishAt,
});

export const statusSchema = z.object({
  status: z.enum(PUBLISH_STATUSES),
  publishAt: publishInputShape.publishAt,
});

export const accessSchema = publicLeadSchema;

export const idParamSchema = z.object({ id: objectId });
export const slugParamSchema = z.object({ slug: z.string().trim().toLowerCase().min(1).max(120) });
export const bulkDeleteSchema = z.object({ ids: z.array(objectId).min(1).max(200) });

const listBase = {
  category: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
  year: yearSchema,
  page: z.coerce.number().int().min(1).default(1),
};

export const publicListSchema = z.object({
  ...listBase,
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export const adminListSchema = z.object({
  ...listBase,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PUBLISH_STATUSES).optional(),
});

export type CreatePyqInput = z.infer<typeof createPyqSchema>;
export type UpdatePyqInput = z.infer<typeof updatePyqSchema>;
export type AccessInput = z.infer<typeof accessSchema>;
