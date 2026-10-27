import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { publishSchemaFields, type PublishStatus } from '../../utils/publishing.js';

/** 'qna' = course-category Q&A page; 'general' = the site-wide FAQs page. */
export type FaqScope = 'qna' | 'general';

export interface IFaq extends Document {
  question: string;
  answer: string;
  scope: FaqScope;
  category?: mongoose.Types.ObjectId;
  sortOrder: number;
  status: PublishStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const FaqSchema = new Schema<IFaq>(
  {
    question: { type: String, required: true, trim: true, maxlength: 500 },
    answer: { type: String, required: true, trim: true, maxlength: 20000 },
    scope: { type: String, enum: ['qna', 'general'], default: 'qna', index: true },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'CourseCategory',
      // Only Q&A entries are grouped by course category.
      required: function (this: IFaq) {
        return this.scope !== 'general';
      },
      index: true,
    },
    sortOrder: { type: Number, default: 0 },
    ...publishSchemaFields,
  },
  { timestamps: true, versionKey: false },
);

FaqSchema.index({ status: 1, category: 1, sortOrder: 1, createdAt: -1 });

export const Faq: Model<IFaq> =
  (mongoose.models.Faq as Model<IFaq> | undefined) ?? mongoose.model<IFaq>('Faq', FaqSchema);
