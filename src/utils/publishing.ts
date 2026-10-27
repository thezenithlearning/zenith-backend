import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import CourseCategoryModel from '../modules/courseCategory/courseCategory.model.js';

/**
 * Shared publishing workflow for FAQ / Quiz / PYQ content.
 *
 *  draft     – never public
 *  published – public immediately
 *  scheduled – becomes public automatically once `publishAt` has passed
 *              (evaluated at query time, so no cron job is required)
 */
export const PUBLISH_STATUSES = ['draft', 'published', 'scheduled'] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

/** Mongoose schema fragment – spread into a schema definition. */
export const publishSchemaFields = {
  status: {
    type: String,
    enum: PUBLISH_STATUSES,
    default: 'draft',
    index: true,
  },
  publishAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
} as const;

/** Zod fragment – spread into a z.object({...}). */
export const publishInputShape = {
  status: z.enum(PUBLISH_STATUSES).default('draft'),
  publishAt: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.date().optional(),
  ),
};

/** Filter matching only content that is publicly visible right now. */
export const liveFilter = (now: Date = new Date()): Record<string, unknown> => ({
  $or: [
    { status: 'published' },
    { status: 'scheduled', publishAt: { $lte: now } },
  ],
});

/** Filter for the admin "status" dropdown, using the same live logic. */
export const statusFilter = (
  status: PublishStatus | undefined,
  now: Date = new Date(),
): Record<string, unknown> | undefined => {
  if (!status) return undefined;
  if (status === 'draft') return { status: 'draft' };
  if (status === 'published') return liveFilter(now);
  return { status: 'scheduled', publishAt: { $gt: now } };
};

interface ExistingPublishing {
  status?: PublishStatus;
  publishAt?: Date | null;
  publishedAt?: Date | null;
}

/** Turns admin input into the persisted publishing fields. */
export const resolvePublishing = (
  input: { status: PublishStatus; publishAt?: Date },
  existing?: ExistingPublishing,
): { status: PublishStatus; publishAt: Date | null; publishedAt: Date | null } => {
  const now = new Date();
  const keptPublishedAt = existing?.publishedAt ?? null;

  if (input.status === 'draft') {
    return { status: 'draft', publishAt: null, publishedAt: null };
  }

  if (input.status === 'published') {
    return { status: 'published', publishAt: null, publishedAt: keptPublishedAt ?? now };
  }

  if (!input.publishAt || Number.isNaN(input.publishAt.getTime())) {
    throw new AppError('Choose a date and time to schedule publishing', 400, 'VALIDATION_ERROR');
  }

  const unchanged =
    existing?.status === 'scheduled' &&
    existing.publishAt &&
    existing.publishAt.getTime() === input.publishAt.getTime();

  if (!unchanged && input.publishAt.getTime() <= now.getTime()) {
    throw new AppError('Scheduled time must be in the future', 400, 'VALIDATION_ERROR');
  }

  return { status: 'scheduled', publishAt: input.publishAt, publishedAt: null };
};

/** Adds computed display fields for the admin UI. */
export const withPublishView = <T extends ExistingPublishing>(
  doc: T,
): T & { isLive: boolean; displayStatus: PublishStatus } => {
  const now = Date.now();
  const scheduledLive =
    doc.status === 'scheduled' && !!doc.publishAt && new Date(doc.publishAt).getTime() <= now;
  const isLive = doc.status === 'published' || scheduledLive;
  const displayStatus: PublishStatus =
    doc.status === 'draft' ? 'draft' : isLive ? 'published' : 'scheduled';
  return { ...doc, isLive, displayStatus };
};

/** Accepts a category ObjectId or slug and returns its ObjectId (null = unknown). */
export const resolveCategoryId = async (
  value?: string,
): Promise<mongoose.Types.ObjectId | null | undefined> => {
  if (!value) return undefined;
  if (mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value) {
    return new mongoose.Types.ObjectId(value);
  }
  const category = await CourseCategoryModel.findOne({ slug: value.toLowerCase() }).select('_id');
  return category ? (category._id as mongoose.Types.ObjectId) : null;
};

export const assertCategoryExists = async (id: string): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(id) || !(await CourseCategoryModel.exists({ _id: id }))) {
    throw new AppError('Selected course category does not exist', 400, 'VALIDATION_ERROR');
  }
};

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/g, '');

/** Returns a slug not used by any document in `model`. */
export const uniqueSlug = async (
  model: mongoose.Model<any>,
  base: string,
  excludeId?: string,
): Promise<string> => {
  const root = slugify(base) || 'item';
  let candidate = root;
  let n = 2;
  for (;;) {
    const clash = await model.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!clash) return candidate;
    candidate = `${root}-${n++}`;
  }
};

export const paginate = (page: number, limit: number) => ({
  skip: (page - 1) * limit,
  limit,
});

export const pageMeta = (total: number, page: number, limit: number) => ({
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

export const notFound = (what: string): AppError =>
  new AppError(`${what} not found`, 404, 'BAD_REQUEST');

export const publicLeadSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s\-()]/g, ''))
    .pipe(z.string().min(7, 'Phone number too short').max(15, 'Phone number too long')),
});
export type PublicLeadInput = z.infer<typeof publicLeadSchema>;
