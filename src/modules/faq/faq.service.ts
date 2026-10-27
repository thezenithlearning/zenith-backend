import { Faq } from './faq.model.js';
import type { CreateFaqInput, UpdateFaqInput } from './faq.validation.js';
import {
  assertCategoryExists,
  escapeRegex,
  liveFilter,
  notFound,
  pageMeta,
  paginate,
  resolveCategoryId,
  resolvePublishing,
  statusFilter,
  withPublishView,
  type PublishStatus,
} from '../../utils/publishing.js';

const CATEGORY_FIELDS = 'name slug';

interface ListParams {
  scope?: 'qna' | 'general';
  category?: string;
  search?: string;
  page: number;
  limit: number;
  status?: PublishStatus;
}

const buildFilter = async (params: ListParams, publicOnly: boolean) => {
  const and: Record<string, unknown>[] = [];

  if (publicOnly) and.push(liveFilter());
  else {
    const sf = statusFilter(params.status);
    if (sf) and.push(sf);
  }

  if (params.scope === 'general') and.push({ scope: 'general' });
  // Entries created before `scope` existed have none and count as Q&A.
  else if (params.scope === 'qna') and.push({ scope: { $ne: 'general' } });

  const categoryId = await resolveCategoryId(params.category);
  if (categoryId === null) return null; // unknown category → empty result
  if (categoryId) and.push({ category: categoryId });

  if (params.search) {
    const rx = new RegExp(escapeRegex(params.search), 'i');
    and.push({ $or: [{ question: rx }, { answer: rx }] });
  }

  return and.length ? { $and: and } : {};
};

export const listPublicFaqs = async (params: ListParams) => {
  const filter = await buildFilter(params, true);
  const { skip, limit } = paginate(params.page, params.limit);
  if (!filter) return { faqs: [], pagination: pageMeta(0, params.page, limit) };

  const [faqs, total] = await Promise.all([
    Faq.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-publishAt -status')
      .populate('category', CATEGORY_FIELDS)
      .lean(),
    Faq.countDocuments(filter),
  ]);
  return { faqs, pagination: pageMeta(total, params.page, limit) };
};

export const listAdminFaqs = async (params: ListParams) => {
  const filter = await buildFilter(params, false);
  const { skip, limit } = paginate(params.page, params.limit);
  const now = new Date();

  const [rows, total, all, live, scheduled, draft] = await Promise.all([
    filter
      ? Faq.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('category', CATEGORY_FIELDS)
          .lean()
      : Promise.resolve([]),
    filter ? Faq.countDocuments(filter) : Promise.resolve(0),
    Faq.countDocuments({}),
    Faq.countDocuments(liveFilter(now)),
    Faq.countDocuments({ status: 'scheduled', publishAt: { $gt: now } }),
    Faq.countDocuments({ status: 'draft' }),
  ]);

  return {
    faqs: rows.map((r) => withPublishView(r)),
    pagination: pageMeta(total, params.page, limit),
    stats: { total: all, published: live, scheduled, draft },
  };
};

export const getFaqById = async (id: string) => {
  const faq = await Faq.findById(id).populate('category', CATEGORY_FIELDS).lean();
  if (!faq) throw notFound('FAQ');
  return withPublishView(faq);
};

export const createFaq = async (input: CreateFaqInput) => {
  if (input.category) await assertCategoryExists(input.category);
  const { status, publishAt, ...rest } = input;
  const faq = await Faq.create({ ...rest, ...resolvePublishing({ status, publishAt }) });
  return getFaqById(String(faq._id));
};

export const updateFaq = async (id: string, input: UpdateFaqInput) => {
  const faq = await Faq.findById(id);
  if (!faq) throw notFound('FAQ');
  if (input.category) await assertCategoryExists(input.category);

  const { status, publishAt, ...rest } = input;
  faq.set(rest);
  if (status) {
    faq.set(resolvePublishing({ status, publishAt }, faq.toObject()));
  }
  await faq.save();
  return getFaqById(id);
};

export const updateFaqStatus = async (
  id: string,
  input: { status: PublishStatus; publishAt?: Date },
) => {
  const faq = await Faq.findById(id);
  if (!faq) throw notFound('FAQ');
  faq.set(resolvePublishing(input, faq.toObject()));
  await faq.save();
  return getFaqById(id);
};

export const deleteFaq = async (id: string) => {
  const faq = await Faq.findByIdAndDelete(id);
  if (!faq) throw notFound('FAQ');
};

export const bulkDeleteFaqs = async (ids: string[]) => {
  const result = await Faq.deleteMany({ _id: { $in: ids } });
  return { deletedCount: result.deletedCount ?? 0 };
};
