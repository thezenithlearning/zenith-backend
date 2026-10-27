import crypto from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ENV } from '../../config/env.js';
import { TrafficDaily } from './traffic.model.js';

const TZ = process.env.TRAFFIC_TIMEZONE || 'Asia/Kolkata';
// Only guards against accidental double-fires; every real visit counts.
const VIEW_DEDUPE_MS = 5 * 1000;

// Crawlers, uptime monitors, link-preview fetchers, headless tools.
const BOT_RE =
  /bot|crawl|spider|slurp|bing|yandex|baidu|duckduck|facebookexternalhit|whatsapp|telegram|preview|monitor|uptime|pingdom|lighthouse|headless|phantom|selenium|puppeteer|playwright|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|postman|insomnia|httpclient|scrapy|gtmetrix/i;

// Pages that are not "website traffic".
const IGNORED_PATH_RE = /^\/(dashboard|login|register|forgot-password|reset-password|api)(\/|$)/;

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD for a date in the traffic timezone. */
export const dayString = (d: Date): string => dayFmt.format(d);

const hashVisitor = (raw: string): string =>
  crypto.createHash('sha256').update(`${ENV.JWT_ACCESS_SECRET}:${raw}`).digest('hex').slice(0, 32);

const deviceOf = (ua: string): 'mobile' | 'tablet' | 'desktop' => {
  if (/ipad|tablet|kindle|silk/i.test(ua)) return 'tablet';
  if (/mobi|android|iphone|ipod/i.test(ua)) return 'mobile';
  return 'desktop';
};

const visitSchema = z.object({
  vid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  path: z.string().min(1).max(300),
  referrer: z.string().max(300).optional(),
});

const visitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(204).end(); // silently drop floods; never error the public site
  },
});

export const trackRouter = Router();

trackRouter.post('/visit', visitLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || BOT_RE.test(ua)) {
      res.status(204).end();
      return;
    }

    const parsed = visitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(204).end();
      return;
    }

    let path = parsed.data.path.split('?')[0].split('#')[0];
    if (!path.startsWith('/')) path = `/${path}`;
    if (IGNORED_PATH_RE.test(path)) {
      res.status(204).end();
      return;
    }

    // Prefer the client's persistent id; fall back to a per-day ip+UA fingerprint.
    const now = new Date();
    const day = dayString(now);
    const vid = hashVisitor(parsed.data.vid ?? `${req.ip}|${ua}|${day}`);

    // Step 1: register the visitor for the day (first insert = a new unique visitor).
    try {
      await TrafficDaily.updateOne(
        { day, vid },
        {
          $setOnInsert: {
            day,
            vid,
            views: 0,
            firstPath: path,
            lastPath: '',
            firstAt: now,
            lastAt: new Date(0),
            referrer: parsed.data.referrer?.slice(0, 300),
            device: deviceOf(ua),
          },
        },
        { upsert: true },
      );

      // Step 2: count the visit (every visit counts) unless it is a rapid double-fire.
      await TrafficDaily.updateOne(
        {
          day,
          vid,
          lastAt: { $lt: new Date(now.getTime() - VIEW_DEDUPE_MS) },
        },
        { $inc: { views: 1 }, $set: { lastPath: path, lastAt: now } },
      );
    } catch (err: any) {
      // Concurrent first hits can race on the unique index; that is harmless.
      if (err?.code !== 11000) throw err;
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ─── Admin analytics ─────────────────────────────────────────────────────────

type Range = 'day' | 'month' | 'year';

const shiftDay = (day: string, delta: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const uniqueTotals = async (match: object): Promise<{ visitors: number; views: number }> => {
  const rows = await TrafficDaily.aggregate([
    { $match: match },
    { $group: { _id: '$vid', views: { $sum: '$views' } } },
    { $group: { _id: null, visitors: { $sum: 1 }, views: { $sum: '$views' } } },
  ]);
  return { visitors: rows[0]?.visitors ?? 0, views: rows[0]?.views ?? 0 };
};

export const getTrafficStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range: Range = ['day', 'month', 'year'].includes(String(req.query.range))
      ? (String(req.query.range) as Range)
      : 'day';

    const today = dayString(new Date());
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);

    // Period buckets (oldest → newest) so empty periods show as zero.
    let keys: string[] = [];
    let len = 10;
    let from = today;
    if (range === 'day') {
      keys = Array.from({ length: 30 }, (_, i) => shiftDay(today, i - 29));
      from = keys[0];
    } else if (range === 'month') {
      const [y, m] = [Number(year), Number(month.slice(5))];
      keys = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
        return d.toISOString().slice(0, 7);
      });
      from = `${keys[0]}-01`;
      len = 7;
    } else {
      keys = Array.from({ length: 5 }, (_, i) => String(Number(year) - 4 + i));
      from = `${keys[0]}-01-01`;
      len = 4;
    }

    const [series, allTime, todayT, yesterdayT, monthT, yearT, devices] = await Promise.all([
      TrafficDaily.aggregate([
        { $match: { day: { $gte: from } } },
        { $group: { _id: { p: { $substr: ['$day', 0, len] }, v: '$vid' }, views: { $sum: '$views' } } },
        { $group: { _id: '$_id.p', visitors: { $sum: 1 }, views: { $sum: '$views' } } },
      ]),
      uniqueTotals({}),
      uniqueTotals({ day: today }),
      uniqueTotals({ day: shiftDay(today, -1) }),
      uniqueTotals({ day: { $gte: `${month}-01` } }),
      uniqueTotals({ day: { $gte: `${year}-01-01` } }),
      TrafficDaily.aggregate([
        { $match: { day: { $gte: shiftDay(today, -29) } } },
        { $group: { _id: { d: '$device', v: '$vid' } } },
        { $group: { _id: '$_id.d', visitors: { $sum: 1 } } },
      ]),
    ]);

    const map = new Map<string, { visitors: number; views: number }>(
      series.map((r: any) => [r._id, { visitors: r.visitors, views: r.views }]),
    );

    res.json({
      success: true,
      data: {
        range,
        timezone: TZ,
        generatedAt: new Date().toISOString(),
        totals: {
          allTime,
          today: todayT,
          yesterday: yesterdayT,
          thisMonth: monthT,
          thisYear: yearT,
        },
        devices: devices.map((d: any) => ({ device: d._id ?? 'desktop', visitors: d.visitors })),
        series: keys.map((k) => ({
          period: k,
          visitors: map.get(k)?.visitors ?? 0,
          views: map.get(k)?.views ?? 0,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};
