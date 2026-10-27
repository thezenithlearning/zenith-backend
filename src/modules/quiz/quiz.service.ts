import { Quiz, type IQuiz, type IQuizQuestion } from './quiz.model.js';
import { QuizAttempt } from './quizAttempt.model.js';
import type { CreateQuizInput, SubmitQuizInput, UpdateQuizInput } from './quiz.validation.js';
import { createLead } from '../lead/lead.service.js';
import { AppError } from '../../errors/AppError.js';
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
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface ListParams {
  category?: string;
  search?: string;
  page: number;
  limit: number;
  status?: PublishStatus;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const totalsFor = (questions: { marks: number }[]) => ({
  questionCount: questions.length,
  totalMarks: round2(questions.reduce((sum, q) => sum + q.marks, 0)),
});

const assertPublishable = (status: PublishStatus, questionCount: number): void => {
  if (status !== 'draft' && questionCount === 0) {
    throw new AppError(
      'Add at least one question before publishing or scheduling this quiz',
      400,
      'VALIDATION_ERROR',
    );
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

  if (params.search) {
    const rx = new RegExp(escapeRegex(params.search), 'i');
    and.push({ $or: [{ title: rx }, { seriesName: rx }, { description: rx }] });
  }

  return and.length ? { $and: and } : {};
};

const SUMMARY_SELECT =
  'title slug description category seriesName durationMinutes questionCount totalMarks attemptCount publishedAt publishAt createdAt';

// ─── public ───────────────────────────────────────────────────────────────────

export const listPublicQuizzes = async (params: ListParams) => {
  const filter = await buildFilter(params, true);
  const { skip, limit } = paginate(params.page, params.limit);
  if (!filter) return { quizzes: [], pagination: pageMeta(0, params.page, limit) };

  const [quizzes, total] = await Promise.all([
    Quiz.find(filter)
      .sort({ publishedAt: -1, publishAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(SUMMARY_SELECT)
      .populate('category', CATEGORY_FIELDS)
      .lean(),
    Quiz.countDocuments(filter),
  ]);
  return { quizzes, pagination: pageMeta(total, params.page, limit) };
};

/** Public quiz payload – never includes correct answers or explanations. */
export const getPublicQuizBySlug = async (slug: string) => {
  const quiz = await Quiz.findOne({ slug, ...liveFilter() })
    .populate('category', CATEGORY_FIELDS)
    .lean();
  if (!quiz) throw notFound('Mock test');

  return {
    _id: quiz._id,
    title: quiz.title,
    slug: quiz.slug,
    description: quiz.description,
    instructions: quiz.instructions,
    category: quiz.category,
    seriesName: quiz.seriesName,
    durationMinutes: quiz.durationMinutes,
    shuffleQuestions: quiz.shuffleQuestions,
    shuffleOptions: quiz.shuffleOptions,
    passPercentage: quiz.passPercentage,
    questionCount: quiz.questionCount,
    totalMarks: quiz.totalMarks,
    seoTitle: quiz.seoTitle,
    seoDescription: quiz.seoDescription,
    questions: quiz.questions.map((q) => ({
      _id: q._id,
      text: q.text,
      type: q.type,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      options: q.options.map((o) => ({ _id: o._id, text: o.text })),
    })),
  };
};

const gradeQuestion = (q: IQuizQuestion, selected: string[]) => {
  const chosen = new Set(selected);
  const correctIds = q.options.filter((o) => o.isCorrect).map((o) => String(o._id));

  if (chosen.size === 0) return { status: 'unattempted' as const, awarded: 0 };

  const isCorrect =
    chosen.size === correctIds.length && correctIds.every((id) => chosen.has(id));

  return isCorrect
    ? { status: 'correct' as const, awarded: q.marks }
    : { status: 'wrong' as const, awarded: -q.negativeMarks };
};

export const submitQuiz = async (quizId: string, input: SubmitQuizInput) => {
  const quiz = await Quiz.findOne({ _id: quizId, ...liveFilter() }).populate<{
    category: { name: string; slug: string };
  }>('category', CATEGORY_FIELDS);
  if (!quiz) throw notFound('Mock test');

  const answerMap = new Map<string, string[]>();
  for (const a of input.answers) answerMap.set(a.questionId, a.selected);

  let score = 0;
  let correct = 0;
  let wrong = 0;
  let unattempted = 0;

  const review = quiz.questions.map((q) => {
    const validIds = new Set(q.options.map((o) => String(o._id)));
    let selected = (answerMap.get(String(q._id)) ?? []).filter((id) => validIds.has(id));
    if (q.type === 'single') selected = selected.slice(0, 1);

    const result = gradeQuestion(q, selected);
    score += result.awarded;
    if (result.status === 'correct') correct++;
    else if (result.status === 'wrong') wrong++;
    else unattempted++;

    return { q, selected, result };
  });

  const totalMarks = quiz.totalMarks;
  const finalScore = round2(score);
  const percentage = totalMarks > 0 ? Math.max(0, round2((finalScore / totalMarks) * 100)) : 0;
  const passed = quiz.passPercentage > 0 ? percentage >= quiz.passPercentage : percentage > 0;

  // The lead is created BEFORE the attempt so a lead is never lost; the score is
  // embedded in the lead so the sales team sees performance at a glance.
  const lead = await createLead({
    name: input.name,
    email: input.email,
    phone: input.phone,
    course: quiz.category.name,
    source: 'mock-test',
    pagePath: `/mock-tests/${quiz.slug}`,
    pageTitle: `Mock Test: ${quiz.title} — scored ${finalScore}/${totalMarks}`.slice(0, 290),
  });

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    lead: lead._id,
    name: input.name,
    email: input.email,
    phone: input.phone,
    answers: input.answers.map((a) => ({ questionId: a.questionId, selected: a.selected })),
    score: finalScore,
    totalMarks,
    correct,
    wrong,
    unattempted,
    percentage,
    passed,
    timeTakenSec: input.timeTakenSec,
  });

  await Quiz.updateOne({ _id: quiz._id }, { $inc: { attemptCount: 1 } });

  return {
    attemptId: attempt._id,
    leadId: lead._id,
    quizTitle: quiz.title,
    score: finalScore,
    totalMarks,
    correct,
    wrong,
    unattempted,
    totalQuestions: quiz.questions.length,
    percentage,
    passed,
    passPercentage: quiz.passPercentage,
    timeTakenSec: input.timeTakenSec,
    showAnswers: quiz.showAnswers,
    review: quiz.showAnswers
      ? review.map(({ q, selected, result }) => ({
          questionId: q._id,
          text: q.text,
          type: q.type,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          explanation: q.explanation ?? '',
          status: result.status,
          awarded: result.awarded,
          selected,
          options: q.options.map((o) => ({ _id: o._id, text: o.text, isCorrect: o.isCorrect })),
        }))
      : [],
  };
};

// ─── admin ────────────────────────────────────────────────────────────────────

export const listAdminQuizzes = async (params: ListParams) => {
  const filter = await buildFilter(params, false);
  const { skip, limit } = paginate(params.page, params.limit);
  const now = new Date();

  const [rows, total, all, live, scheduled, draft] = await Promise.all([
    filter
      ? Quiz.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select(`${SUMMARY_SELECT} status`)
          .populate('category', CATEGORY_FIELDS)
          .lean()
      : Promise.resolve([]),
    filter ? Quiz.countDocuments(filter) : Promise.resolve(0),
    Quiz.countDocuments({}),
    Quiz.countDocuments(liveFilter(now)),
    Quiz.countDocuments({ status: 'scheduled', publishAt: { $gt: now } }),
    Quiz.countDocuments({ status: 'draft' }),
  ]);

  return {
    quizzes: rows.map((r) => withPublishView(r)),
    pagination: pageMeta(total, params.page, limit),
    stats: { total: all, published: live, scheduled, draft },
  };
};

export const getAdminQuiz = async (id: string) => {
  const quiz = await Quiz.findById(id).populate('category', CATEGORY_FIELDS).lean();
  if (!quiz) throw notFound('Mock test');
  return withPublishView(quiz);
};

export const createQuiz = async (input: CreateQuizInput) => {
  await assertCategoryExists(input.category);
  const { status, publishAt, slug, ...rest } = input;
  assertPublishable(status, rest.questions.length);

  const finalSlug = await resolveSlug(slug, rest.title);
  const quiz = await Quiz.create({
    ...rest,
    slug: finalSlug,
    ...totalsFor(rest.questions),
    ...resolvePublishing({ status, publishAt }),
  });
  return getAdminQuiz(String(quiz._id));
};

const resolveSlug = async (slug: string | undefined, title: string, excludeId?: string) => {
  if (slug) {
    const free = (await uniqueSlug(Quiz, slug, excludeId)) === slug;
    if (!free) throw new AppError('That slug is already in use', 400, 'VALIDATION_ERROR');
    return slug;
  }
  return uniqueSlug(Quiz, title, excludeId);
};

export const updateQuiz = async (id: string, input: UpdateQuizInput) => {
  const quiz = await Quiz.findById(id);
  if (!quiz) throw notFound('Mock test');
  if (input.category) await assertCategoryExists(input.category);

  const { status, publishAt, slug, ...rest } = input;

  if (slug && slug !== quiz.slug) quiz.slug = await resolveSlug(slug, quiz.title, id);
  quiz.set(rest);

  if (rest.questions) quiz.set(totalsFor(rest.questions));
  if (status) quiz.set(resolvePublishing({ status, publishAt }, quiz.toObject()));

  assertPublishable(quiz.status, quiz.questions.length);
  await quiz.save();
  return getAdminQuiz(id);
};

export const updateQuizStatus = async (
  id: string,
  input: { status: PublishStatus; publishAt?: Date },
) => {
  const quiz = await Quiz.findById(id);
  if (!quiz) throw notFound('Mock test');
  assertPublishable(input.status, quiz.questions.length);
  quiz.set(resolvePublishing(input, quiz.toObject()));
  await quiz.save();
  return getAdminQuiz(id);
};

export const deleteQuiz = async (id: string) => {
  const quiz = await Quiz.findByIdAndDelete(id);
  if (!quiz) throw notFound('Mock test');
  await QuizAttempt.deleteMany({ quiz: id });
};

export const bulkDeleteQuizzes = async (ids: string[]) => {
  const result = await Quiz.deleteMany({ _id: { $in: ids } });
  await QuizAttempt.deleteMany({ quiz: { $in: ids } });
  return { deletedCount: result.deletedCount ?? 0 };
};

export const listAttempts = async (quizId: string, page: number, limit: number) => {
  const { skip } = paginate(page, limit);
  const [attempts, total] = await Promise.all([
    QuizAttempt.find({ quiz: quizId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-answers')
      .lean(),
    QuizAttempt.countDocuments({ quiz: quizId }),
  ]);
  return { attempts, pagination: pageMeta(total, page, limit) };
};

export type { IQuiz };
