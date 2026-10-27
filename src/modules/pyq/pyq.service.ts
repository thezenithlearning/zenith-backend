import { Pyq } from './pyq.model.js';
import type { AccessInput, CreatePyqInput, UpdatePyqInput } from './pyq.validation.js';
import { createLead } from '../lead/lead.service.js';
import { AppError } from '../../errors/AppError.js';
import { deleteFile, uploadFile } from '../../utils/fileUpload.js';
import { logger } from '../../config/logger.js';
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
  uniqueSlug,
  withPublishView,
  type PublishStatus,
} from '../../utils/publishing.js';

const CATEGORY_FIELDS = 'name slug';

interface ListParams {
  category?: string;
  search?: string;
  year?: number;
  page: number;
  limit: number;
  status?: PublishStatus;
}

// Public payloads must never expose the PDF location – it is only released by
// `requestAccess` after the visitor has submitted the lead form.
const PUBLIC_SELECT =
  'title slug description category examName year keywords seoTitle seoDescription accessCount publishedAt publishAt createdAt pdf.size pdf.pages';

const assertPdf = (file: Express.Multer.File): void => {
  const looksLikePdf = file.buffer?.subarray(0, 5).toString('latin1') === '%PDF-';
  if (file.mimetype !== 'application/pdf' || !looksLikePdf) {
    throw new AppError('Only valid PDF files can be uploaded', 400, 'BAD_REQUEST');
  }
};

const cleanupKey = async (storageKey?: string): Promise<void> => {
  if (!storageKey) return;
  try {
    await deleteFile(storageKey);
  } catch (error) {
    logger.warn({ err: error, storageKey }, 'Failed to delete stored PYQ file');
  }
};

const buildFilter = async (params: ListParams, publicOnly: boolean) => {
  const and: Record<string, unknown>[] = [];

  if (publicOnly) and.push(liveFilter());
  else {
    const sf = statusFilter(params.status);
    if (sf) and.push(sf);
  }

  const categoryId = await resolveCategoryId(params.category);
  if (categoryId === null) return null;
  if (categoryId) and.push({ category: categoryId });

  if (params.year) and.push({ year: params.year });

  if (params.search) {
    const rx = new RegExp(escapeRegex(params.search), 'i');
    and.push({ $or: [{ title: rx }, { examName: rx }, { keywords: rx }] });
  }

  return and.length ? { $and: and } : {};
};

const resolveSlug = async (slug: string | undefined, title: string, excludeId?: string) => {
  if (slug) {
    if ((await uniqueSlug(Pyq, slug, excludeId)) !== slug) {
      throw new AppError('That slug is already in use', 400, 'VALIDATION_ERROR');
    }
    return slug;
  }
  return uniqueSlug(Pyq, title, excludeId);
};

// ─── public ───────────────────────────────────────────────────────────────────

export const listPublicPyqs = async (params: ListParams) => {
  const filter = await buildFilter(params, true);
  const { skip, limit } = paginate(params.page, params.limit);
  if (!filter) return { pyqs: [], pagination: pageMeta(0, params.page, limit) };

  const [pyqs, total] = await Promise.all([
    Pyq.find(filter)
      .sort({ year: -1, publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(PUBLIC_SELECT)
      .populate('category', CATEGORY_FIELDS)
      .lean(),
    Pyq.countDocuments(filter),
  ]);
  return { pyqs, pagination: pageMeta(total, params.page, limit) };
};

export const getPublicPyqBySlug = async (slug: string) => {
  const pyq = await Pyq.findOne({ slug, ...liveFilter() })
    .select(PUBLIC_SELECT)
    .populate('category', CATEGORY_FIELDS)
    .lean();
  if (!pyq) throw notFound('PYQ');
  return pyq;
};

/** Captures the lead, then releases the PDF location. */
export const requestAccess = async (id: string, input: AccessInput) => {
  const pyq = await Pyq.findOne({ _id: id, ...liveFilter() }).populate<{
    category: { name: string };
  }>('category', CATEGORY_FIELDS);
  if (!pyq) throw notFound('PYQ');

  const lead = await createLead({
    name: input.name,
    email: input.email,
    phone: input.phone,
    course: pyq.category.name,
    source: 'pyq',
    pagePath: `/pyqs/${pyq.slug}`,
    pageTitle: `PYQ: ${pyq.title}`.slice(0, 290),
  });

  await Pyq.updateOne({ _id: pyq._id }, { $inc: { accessCount: 1 } });

  return {
    leadId: lead._id,
    title: pyq.title,
    file: {
      url: pyq.pdf.url,
      storageKey: pyq.pdf.storageKey,
      originalName: pyq.pdf.originalName,
      mimeType: pyq.pdf.mimeType,
      size: pyq.pdf.size,
    },
  };
};

// ─── admin ────────────────────────────────────────────────────────────────────

export const listAdminPyqs = async (params: ListParams) => {
  const filter = await buildFilter(params, false);
  const { skip, limit } = paginate(params.page, params.limit);
  const now = new Date();

  const [rows, total, all, live, scheduled, draft] = await Promise.all([
    filter
      ? Pyq.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('category', CATEGORY_FIELDS)
          .lean()
      : Promise.resolve([]),
    filter ? Pyq.countDocuments(filter) : Promise.resolve(0),
    Pyq.countDocuments({}),
    Pyq.countDocuments(liveFilter(now)),
    Pyq.countDocuments({ status: 'scheduled', publishAt: { $gt: now } }),
    Pyq.countDocuments({ status: 'draft' }),
  ]);

  return {
    pyqs: rows.map((r) => withPublishView(r)),
    pagination: pageMeta(total, params.page, limit),
    stats: { total: all, published: live, scheduled, draft },
  };
};

export const getAdminPyq = async (id: string) => {
  const pyq = await Pyq.findById(id).populate('category', CATEGORY_FIELDS).lean();
  if (!pyq) throw notFound('PYQ');
  return withPublishView(pyq);
};

export const createPyq = async (input: CreatePyqInput, file?: Express.Multer.File) => {
  if (!file) throw new AppError('Upload the PYQ PDF file', 400, 'VALIDATION_ERROR');
  assertPdf(file);
  await assertCategoryExists(input.category);

  const { status, publishAt, slug, ...rest } = input;
  const publishing = resolvePublishing({ status, publishAt });
  const finalSlug = await resolveSlug(slug, rest.title);

  const pdf = await uploadFile(file, 'pyq', rest.title);
  try {
    const pyq = await Pyq.create({ ...rest, slug: finalSlug, pdf, ...publishing });
    return await getAdminPyq(String(pyq._id));
  } catch (error) {
    await cleanupKey(pdf.storageKey);
    throw error;
  }
};

export const updatePyq = async (id: string, input: UpdatePyqInput, file?: Express.Multer.File) => {
  const pyq = await Pyq.findById(id);
  if (!pyq) throw notFound('PYQ');
  if (input.category) await assertCategoryExists(input.category);
  if (file) assertPdf(file);

  const { status, publishAt, slug, ...rest } = input;
  if (slug && slug !== pyq.slug) pyq.slug = await resolveSlug(slug, pyq.title, id);
  pyq.set(rest);
  if (status) pyq.set(resolvePublishing({ status, publishAt }, pyq.toObject()));

  const oldKey = pyq.pdf.storageKey;
  let newKey: string | undefined;
  if (file) {
    const pdf = await uploadFile(file, 'pyq', pyq.title);
    newKey = pdf.storageKey;
    pyq.set('pdf', pdf);
  }

  try {
    await pyq.save();
  } catch (error) {
    await cleanupKey(newKey);
    throw error;
  }
  if (newKey) await cleanupKey(oldKey);
  return getAdminPyq(id);
};

export const updatePyqStatus = async (
  id: string,
  input: { status: PublishStatus; publishAt?: Date },
) => {
  const pyq = await Pyq.findById(id);
  if (!pyq) throw notFound('PYQ');
  pyq.set(resolvePublishing(input, pyq.toObject()));
  await pyq.save();
  return getAdminPyq(id);
};

export const deletePyq = async (id: string) => {
  const pyq = await Pyq.findByIdAndDelete(id);
  if (!pyq) throw notFound('PYQ');
  await cleanupKey(pyq.pdf?.storageKey);
};

export const bulkDeletePyqs = async (ids: string[]) => {
  const docs = await Pyq.find({ _id: { $in: ids } }).select('pdf.storageKey');
  const result = await Pyq.deleteMany({ _id: { $in: ids } });
  await Promise.all(docs.map((d) => cleanupKey(d.pdf?.storageKey)));
  return { deletedCount: result.deletedCount ?? 0 };
};
