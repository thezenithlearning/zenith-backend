import { Router, type NextFunction, type Request, type Response } from 'express';
import { authorize, protect } from '../../middlewares/auth.middleware.js';
import { User } from '../auth/auth.model.js';
import Course from '../course/course.model.js';
import Blog from '../blog/blog.model.js';
import { Lead } from '../lead/lead.model.js';
import { Faq } from '../faq/faq.model.js';
import { Pyq } from '../pyq/pyq.model.js';
import { Quiz } from '../quiz/quiz.model.js';
import { AssetModel } from '../asset/asset.model.js';
import { getTrafficStats } from '../traffic/traffic.routes.js';

const router = Router();

const DAY = 24 * 60 * 60 * 1000;

type Bucket = { _id: string; count: number };

const countBy = async (model: any, field: string, match: object = {}): Promise<Record<string, number>> => {
  const rows: Bucket[] = await model.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
};

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

const dailySeries = async (model: any, since: Date, days: number) => {
  const rows: Bucket[] = await model.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
  ]);
  const map = new Map(rows.map((r) => [r._id, r.count]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10);
    return { date, count: map.get(date) ?? 0 };
  });
};

const monthlySeries = async (model: any, since: Date) => {
  const rows: Bucket[] = await model.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
};

router.get('/traffic', protect, authorize('admin'), getTrafficStats);

router.get('/stats', protect, authorize('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const since30 = new Date(now.getTime() - 29 * DAY);
    since30.setUTCHours(0, 0, 0, 0);
    const since6m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const [
      userTotal, userVerified,
      courseStatus, blogStatus, leadStatus, qnaStatus, pyqStatus, quizStatus,
      pyqSize, quizAgg, assetAgg, assetTypes,
      leadsDaily,
      mCourse, mBlog, mPyq, mQuiz, mQna,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      countBy(Course, 'status'),
      countBy(Blog, 'status'),
      countBy(Lead, 'status'),
      countBy(Faq, 'status', { scope: 'qna' }),
      countBy(Pyq, 'status'),
      countBy(Quiz, 'status'),
      Pyq.aggregate([{ $group: { _id: null, bytes: { $sum: '$pdf.size' }, accesses: { $sum: '$accessCount' } } }]),
      Quiz.aggregate([{ $group: { _id: null, questions: { $sum: '$questionCount' }, attempts: { $sum: '$attemptCount' } } }]),
      AssetModel.aggregate([{ $group: { _id: null, bytes: { $sum: '$size' }, files: { $sum: 1 } } }]),
      AssetModel.aggregate([{ $group: { _id: '$assetType', bytes: { $sum: '$size' }, files: { $sum: 1 } } }]),
      dailySeries(Lead, since30, 30),
      monthlySeries(Course, since6m),
      monthlySeries(Blog, since6m),
      monthlySeries(Pyq, since6m),
      monthlySeries(Quiz, since6m),
      monthlySeries(Faq, since6m),
    ]);

    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
      return d.toISOString().slice(0, 7);
    });
    const contentByMonth = months.map((m) => ({
      month: m,
      courses: mCourse[m] ?? 0,
      blogs: mBlog[m] ?? 0,
      pdfs: mPyq[m] ?? 0,
      mcqs: mQuiz[m] ?? 0,
      qna: mQna[m] ?? 0,
    }));

    res.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        users: { total: userTotal, verified: userVerified },
        courses: { total: sum(courseStatus), live: courseStatus.active ?? 0, upcoming: courseStatus.upcoming ?? 0, ended: courseStatus.ended ?? 0 },
        blogs: { total: sum(blogStatus), published: blogStatus.published ?? 0, draft: blogStatus.draft ?? 0 },
        leads: {
          total: sum(leadStatus),
          new: leadStatus.new ?? 0,
          contacted: leadStatus.contacted ?? 0,
          enrolled: leadStatus.enrolled ?? 0,
          lost: leadStatus.lost ?? 0,
        },
        qna: { total: sum(qnaStatus), published: qnaStatus.published ?? 0, draft: qnaStatus.draft ?? 0, scheduled: qnaStatus.scheduled ?? 0 },
        pdfs: {
          total: sum(pyqStatus), published: pyqStatus.published ?? 0, draft: pyqStatus.draft ?? 0, scheduled: pyqStatus.scheduled ?? 0,
          bytes: pyqSize[0]?.bytes ?? 0, accesses: pyqSize[0]?.accesses ?? 0,
        },
        mcqs: {
          total: sum(quizStatus), published: quizStatus.published ?? 0, draft: quizStatus.draft ?? 0, scheduled: quizStatus.scheduled ?? 0,
          questions: quizAgg[0]?.questions ?? 0, attempts: quizAgg[0]?.attempts ?? 0,
        },
        storage: {
          files: assetAgg[0]?.files ?? 0,
          bytes: assetAgg[0]?.bytes ?? 0,
          byType: assetTypes.map((t: any) => ({ type: t._id, files: t.files, bytes: t.bytes })),
        },
        leadsDaily,
        contentByMonth,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
