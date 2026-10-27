import { z } from 'zod';
import { PUBLISH_STATUSES, publicLeadSchema, publishInputShape } from '../../utils/publishing.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const optionSchema = z.object({
  _id: objectId.optional(),
  text: z.string().trim().min(1, 'Option text is required').max(1000),
  isCorrect: z.boolean().default(false),
});

export const questionSchema = z
  .object({
    _id: objectId.optional(),
    text: z.string().trim().min(1, 'Question text is required').max(4000),
    type: z.enum(['single', 'multiple']).default('single'),
    options: z.array(optionSchema).min(2, 'Each question needs at least 2 options').max(8),
    marks: z.coerce.number().min(0, 'Marks cannot be negative').max(1000),
    negativeMarks: z.coerce.number().min(0, 'Negative marks cannot be negative').max(1000).default(0),
    explanation: z.string().trim().max(4000).optional().default(''),
  })
  .superRefine((q, ctx) => {
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (correct === 0) {
      ctx.addIssue({ code: 'custom', message: 'Mark at least one correct option', path: ['options'] });
    }
    if (q.type === 'single' && correct > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'A single-answer question can only have one correct option',
        path: ['options'],
      });
    }
  });

const fields = {
  title: z.string().trim().min(3, 'Title is required').max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(100)
    .regex(slugPattern, 'Slug may contain lowercase letters, numbers and hyphens only')
    .optional()
    .or(z.literal('')),
  description: z.string().trim().max(5000).default(''),
  instructions: z.string().trim().max(5000).default(''),
  category: objectId,
  seriesName: z.string().trim().max(150).default(''),
  durationMinutes: z.coerce.number().int().min(0).max(600).default(0),
  defaultMarks: z.coerce.number().min(0).max(1000).default(1),
  defaultNegativeMarks: z.coerce.number().min(0).max(1000).default(0),
  passPercentage: z.coerce.number().min(0).max(100).default(0),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  showAnswers: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).default(''),
  seoDescription: z.string().trim().max(400).default(''),
  questions: z.array(questionSchema).max(300).default([]),
};

export const createQuizSchema = z.object({ ...fields, ...publishInputShape });

// Partial update: strip defaults so untouched fields are not reset.
export const updateQuizSchema = z.object({
  title: fields.title.optional(),
  slug: fields.slug,
  description: z.string().trim().max(5000).optional(),
  instructions: z.string().trim().max(5000).optional(),
  category: fields.category.optional(),
  seriesName: z.string().trim().max(150).optional(),
  durationMinutes: z.coerce.number().int().min(0).max(600).optional(),
  defaultMarks: z.coerce.number().min(0).max(1000).optional(),
  defaultNegativeMarks: z.coerce.number().min(0).max(1000).optional(),
  passPercentage: z.coerce.number().min(0).max(100).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  showAnswers: z.boolean().optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
  questions: z.array(questionSchema).max(300).optional(),
  status: z.enum(PUBLISH_STATUSES).optional(),
  publishAt: publishInputShape.publishAt,
});

export const statusSchema = z.object({
  status: z.enum(PUBLISH_STATUSES),
  publishAt: publishInputShape.publishAt,
});

export const submitSchema = publicLeadSchema.extend({
  answers: z
    .array(
      z.object({
        questionId: objectId,
        selected: z.array(objectId).max(8).default([]),
      }),
    )
    .max(300)
    .default([]),
  timeTakenSec: z.coerce.number().int().min(0).max(60 * 60 * 24).default(0),
});

export const idParamSchema = z.object({ id: objectId });
export const slugParamSchema = z.object({ slug: z.string().trim().toLowerCase().min(1).max(120) });
export const bulkDeleteSchema = z.object({ ids: z.array(objectId).min(1).max(200) });

const listBase = {
  category: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
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
export const attemptsListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type UpdateQuizInput = z.infer<typeof updateQuizSchema>;
export type SubmitQuizInput = z.infer<typeof submitSchema>;
