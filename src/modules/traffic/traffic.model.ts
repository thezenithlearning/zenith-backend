import mongoose, { Schema, type Model } from 'mongoose';

/**
 * One document per unique visitor per day.
 *
 *  - `vid`   : salted SHA-256 of the visitor id (never the raw id / IP).
 *  - `day`   : YYYY-MM-DD in the configured traffic timezone.
 *
 * `views` is the number of visits (site entries) that visitor made that day.
 * The unique {day, vid} index keeps the unique-visitor count at one per day,
 * while `views` rises with every real visit.
 */
export interface ITrafficDaily {
  day: string;
  vid: string;
  views: number;
  firstPath: string;
  lastPath: string;
  firstAt: Date;
  lastAt: Date;
  referrer?: string;
  device?: 'mobile' | 'tablet' | 'desktop';
}

const trafficDailySchema = new Schema<ITrafficDaily>(
  {
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    vid: { type: String, required: true },
    views: { type: Number, default: 0, min: 0 },
    firstPath: { type: String, default: '' },
    lastPath: { type: String, default: '' },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    referrer: { type: String },
    device: { type: String, enum: ['mobile', 'tablet', 'desktop'] },
  },
  { versionKey: false },
);

trafficDailySchema.index({ day: 1, vid: 1 }, { unique: true });
trafficDailySchema.index({ vid: 1 });

export const TrafficDaily: Model<ITrafficDaily> =
  (mongoose.models.TrafficDaily as Model<ITrafficDaily> | undefined) ??
  mongoose.model<ITrafficDaily>('TrafficDaily', trafficDailySchema);
