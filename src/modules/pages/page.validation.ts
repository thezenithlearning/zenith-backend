import { z } from 'zod';

import {
  BULK_ACTIONS,
  CHANGE_FREQUENCIES,
  CHILD_DISPLAYS,
  DEFAULT_PAGE_SIZE,
  FOLDER_BEHAVIORS,
  MAX_BULK_IDS,
  MAX_CONTENT_LENGTH,
  MAX_PAGE_SIZE,
  MAX_SLUG_LENGTH,
  NODE_SORT_FIELDS,
  NODE_STATUSES,
  NODE_TYPES,
  OBJECT_ID_PATTERN,
  PAGE_LAYOUTS,
  PAGE_WIDTHS,
  SLUG_PATTERN,
  TWITTER_CARDS,
} from './page.constants.js';
import { sectionsSchema } from './page.sections.js';

const objectId = z.string().regex(OBJECT_ID_PATTERN, 'Must be a valid 24 character id');

/** Lower-cased first so "About" is accepted as "about", then strictly checked. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Slug is required')
  .max(MAX_SLUG_LENGTH)
  .regex(SLUG_PATTERN, 'Slug may only contain lowercase letters, numbers and single hyphens');

/** Absolute http(s) URL or a site-relative path ("/images/x.png"). */
const urlOrPath = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === '' || /^\/(?!\/)[^\s]*$/.test(value) || /^https?:\/\/[^\s]+$/i.test(value),
    'Must be an absolute http(s) URL or a path starting with /',
  );

const keywordList = z
  .array(z.string().trim().min(1).max(60))
  .max(30)
  .transform((items) => [...new Set(items.map((item) => item.toLowerCase()))]);

const seoSchema = z
  .object({
    title: z.string().trim().max(120),
    description: z.string().trim().max(320),
    canonicalUrl: urlOrPath,
    robotsIndex: z.boolean(),
    robotsFollow: z.boolean(),
    ogTitle: z.string().trim().max(120),
    ogDescription: z.string().trim().max(320),
    ogImage: urlOrPath,
    twitterCard: z.enum(TWITTER_CARDS),
    keywords: keywordList,
    breadcrumbTitle: z.string().trim().max(120),
    sitemapInclude: z.boolean(),
    sitemapPriority: z.number().min(0).max(1).nullable(),
    sitemapChangeFrequency: z.enum(CHANGE_FREQUENCIES).nullable(),
  })
  .partial()
  .strict();

const appearanceSchema = z
  .object({
    layout: z.enum(PAGE_LAYOUTS),
    pageWidth: z.enum(PAGE_WIDTHS),
    showHeading: z.boolean(),
    showBreadcrumbs: z.boolean(),
    coverImageUrl: urlOrPath,
    coverImageAlt: z.string().trim().max(300),
    childDisplay: z.enum(CHILD_DISPLAYS),
    childrenTitle: z.string().trim().max(120),
  })
  .partial()
  .strict();

const navigationSchema = z.object({ showInNavigation: z.boolean() }).partial().strict();

// null / "" must stay "no date": z.coerce.date() would turn null into 1970.
const dateOrNull = z.preprocess(
  (value) => (value === '' ? null : value),
  z.union([z.null(), z.coerce.date()]),
);

const contentShape = {
  slug: slugSchema.optional(),
  status: z.enum(NODE_STATUSES).optional(),
  order: z.number().int().min(0).optional(),
  heading: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(1000).optional(),
  html: z.string().max(MAX_CONTENT_LENGTH).optional(),
  sections: sectionsSchema.optional(),
  folderBehavior: z.enum(FOLDER_BEHAVIORS).optional(),
  seo: seoSchema.optional(),
  appearance: appearanceSchema.optional(),
  navigation: navigationSchema.optional(),
  publishAt: dateOrNull.optional(),
  unpublishAt: dateOrNull.optional(),
};

const scheduleRule = (value: { publishAt?: Date | null; unpublishAt?: Date | null }) =>
  !value.publishAt || !value.unpublishAt || value.unpublishAt > value.publishAt;

const scheduleMessage = {
  message: 'Unpublish date must be after the publish date',
  path: ['unpublishAt'],
};

export const createNodeSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    type: z.enum(NODE_TYPES),
    parentId: objectId.nullable().default(null),
    ...contentShape,
  })
  .strict()
  .refine(scheduleRule, scheduleMessage);

export const updateNodeSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    ...contentShape,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })
  .refine(scheduleRule, scheduleMessage);

export const moveNodeSchema = z.object({ parentId: objectId.nullable() }).strict();

export const reorderSchema = z
  .object({
    parentId: objectId.nullable(),
    orderedIds: z
      .array(objectId)
      .min(1)
      .max(MAX_PAGE_SIZE * 5),
  })
  .strict();

export const bulkSchema = z
  .object({
    action: z.enum(BULK_ACTIONS),
    ids: z
      .array(objectId)
      .min(1)
      .max(MAX_BULK_IDS)
      .transform((ids) => [...new Set(ids)]),
    cascade: z.boolean().default(false),
  })
  .strict();

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

export const listNodesQuerySchema = z.object({
  parentId: z.union([z.literal('root'), objectId]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  type: z.enum(NODE_TYPES).optional(),
  status: z.enum(NODE_STATUSES).optional(),
  navigation: booleanQuery.optional(),
  indexed: booleanQuery.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sortBy: z.enum(NODE_SORT_FIELDS).default('order'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const nodeIdParamSchema = z.object({ id: objectId });

export const deleteQuerySchema = z.object({ cascade: booleanQuery.default(false) });

export const publicPathQuerySchema = z.object({
  path: z.string().trim().max(2000).default(''),
});
