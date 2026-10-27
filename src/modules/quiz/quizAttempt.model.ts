import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IQuizAttempt extends Document {
  quiz: mongoose.Types.ObjectId;
  lead?: mongoose.Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  answers: { questionId: string; selected: string[] }[];
  score: number;
  totalMarks: number;
  correct: number;
  wrong: number;
  unattempted: number;
  percentage: number;
  passed: boolean;
  timeTakenSec: number;
  createdAt: Date;
}

const QuizAttemptSchema = new Schema<IQuizAttempt>(
  {
    quiz: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    lead: { type: Schema.Types.ObjectId, ref: 'Lead' },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    answers: {
      type: [
        new Schema(
          { questionId: String, selected: { type: [String], default: [] } },
          { _id: false },
        ),
      ],
      default: [],
    },
    score: { type: Number, required: true },
    totalMarks: { type: Number, required: true },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    unattempted: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    timeTakenSec: { type: Number, default: 0, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

QuizAttemptSchema.index({ quiz: 1, createdAt: -1 });

export const QuizAttempt: Model<IQuizAttempt> =
  (mongoose.models.QuizAttempt as Model<IQuizAttempt> | undefined) ??
  mongoose.model<IQuizAttempt>('QuizAttempt', QuizAttemptSchema);
