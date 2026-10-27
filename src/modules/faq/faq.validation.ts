import { z } from 'zod';
import { PUBLISH_STATUSES, publishInputShape } from '../../utils/publishing.js';

const FAQ_SCOPES = ['qna', 'general'] as const;

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const base = {
  question: z.string().trim().min(3, 'Question is required').max(500),
  answer: z
    .string()
    .trim()
    .min(1, 'Answer is required')
    .max(20000)
    .refine((v) => v.replace(/<[^>]*>/g, '').trim().length > 0, 'Answer is required'),
  scope: z.enum(FAQ_SCOPES).default('qna'),
  category: objectId.optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  ...publishInputShape,
};

export const createFaqSchema = z.object(base).refine((v) => v.scope === 'general' || Boolean(v.category), {
  message: 'Choose a course category for Q&A entries',
  path: ['category'],
});

// Updates are partial and must NOT re-apply defaults (status / sortOrder),
// otherwise editing one field would silently reset publishing state.
export const updateFaqSchema = z.object({
  question: base.question.optional(),
  answer: base.answer.optional(),
  scope: z.enum(FAQ_SCOPES).optional(),
  category: base.category,
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  status: z.enum(PUBLISH_STATUSES).optional(),
  publishAt: publishInputShape.publishAt,
});

export const statusSchema = z.object({
  status: z.enum(PUBLISH_STATUSES),
  publishAt: publishInputShape.publishAt,
});

export const idParamSchema = z.object({ id: objectId });
export const bulkDeleteSchema = z.object({ ids: z.array(objectId).min(1).max(200) });

const listBase = {
  scope: z.enum(FAQ_SCOPES).optional(),
  category: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
};

export const publicListSchema = z.object({
  ...listBase,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const adminListSchema = z.object({
  ...listBase,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PUBLISH_STATUSES).optional(),
});

export type CreateFaqInput = z.infer<typeof createFaqSchema>;
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;
