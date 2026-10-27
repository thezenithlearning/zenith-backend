import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { publishSchemaFields, type PublishStatus } from '../../utils/publishing.js';

export type QuestionType = 'single' | 'multiple';

export interface IQuizOption {
  _id: mongoose.Types.ObjectId;
  text: string;
  isCorrect: boolean;
}

export interface IQuizQuestion {
  _id: mongoose.Types.ObjectId;
  text: string;
  type: QuestionType;
  options: IQuizOption[];
  marks: number;
  negativeMarks: number;
  explanation?: string;
}

export interface IQuiz extends Document {
  title: string;
  slug: string;
  description: string;
  instructions: string;
  category: mongoose.Types.ObjectId;
  seriesName: string;
  durationMinutes: number; // 0 = untimed
  defaultMarks: number;
  defaultNegativeMarks: number;
  passPercentage: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showAnswers: boolean;
  questions: IQuizQuestion[];
  questionCount: number;
  totalMarks: number;
  attemptCount: number;
  seoTitle: string;
  seoDescription: string;
  status: PublishStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OptionSchema = new Schema<IQuizOption>(
  {
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true },
);

const QuestionSchema = new Schema<IQuizQuestion>(
  {
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    type: { type: String, enum: ['single', 'multiple'], default: 'single' },
    options: { type: [OptionSchema], default: [] },
    marks: { type: Number, default: 1, min: 0 },
    negativeMarks: { type: Number, default: 0, min: 0 },
    explanation: { type: String, trim: true, maxlength: 4000, default: '' },
  },
  { _id: true },
);

const QuizSchema = new Schema<IQuiz>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '', trim: true, maxlength: 5000 },
    instructions: { type: String, default: '', trim: true, maxlength: 5000 },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'CourseCategory',
      required: true,
      index: true,
    },
    seriesName: { type: String, default: '', trim: true, maxlength: 150 },
    durationMinutes: { type: Number, default: 0, min: 0, max: 600 },
    defaultMarks: { type: Number, default: 1, min: 0 },
    defaultNegativeMarks: { type: Number, default: 0, min: 0 },
    passPercentage: { type: Number, default: 0, min: 0, max: 100 },
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },
    showAnswers: { type: Boolean, default: true },
    questions: { type: [QuestionSchema], default: [] },
    questionCount: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    attemptCount: { type: Number, default: 0 },
    seoTitle: { type: String, default: '', trim: true, maxlength: 200 },
    seoDescription: { type: String, default: '', trim: true, maxlength: 400 },
    ...publishSchemaFields,
  },
  { timestamps: true, versionKey: false },
);

QuizSchema.index({ status: 1, category: 1, publishedAt: -1 });

export const Quiz: Model<IQuiz> =
  (mongoose.models.Quiz as Model<IQuiz> | undefined) ?? mongoose.model<IQuiz>('Quiz', QuizSchema);
