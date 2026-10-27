import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Course from '../modules/course/course.model.js';
import CourseCategory from '../modules/courseCategory/courseCategory.model.js';

// Zenith programs are enquiry-based: price stays 0 and the CTA points to the
// admissions form instead of an external checkout.
const ENQUIRY_URL = 'https://thezenithlearning.com/contact-us';

const shared = {
  currency: 'USD',
  status: 'active',
  language: 'English',
  level: 'all-levels',
  durationWeeks: 24,
  format: 'Live 1:1 + Practice',
  price: 0,
  discountedPrice: 0,
  purchaseUrl: ENQUIRY_URL,
  requirements: ['A laptop or tablet with a stable internet connection', 'Commitment to regular practice'],
  tools: [{ name: 'Live Classes' }, { name: 'Practice Worksheets' }, { name: 'Weekly Tests' }, { name: 'Progress Reports' }],
  certificate: {
    description: 'Programme completion record from Zenith Learning.',
    requirements: ['Complete the core modules and weekly assessments'],
  },
};

const programs = [
  {
    ...shared,
    title: 'IB DP Physics (HL/SL)',
    slug: 'ib-dp-physics',
    category: 'International',
    subCategory: 'IB Diploma',
    shortDescription: 'HL/SL conceptual learning, application, exam practice and IA support.',
    heroHeadline: 'Turn difficult Physics concepts into confident problem-solving',
    keywords: ['IB Physics tutor', 'IB DP Physics HL', 'IB Physics IA support'],
    highlights: [{ label: 'Levels', value: 'HL + SL' }, { label: 'Format', value: '1:1 Live' }, { label: 'Includes', value: 'IA Support' }],
    whatYouWillLearn: ['Core and option topics with conceptual depth', 'Data-based and unfamiliar-question strategy', 'Internal Assessment planning and write-up', 'Paper 1, 2 and 3 exam technique'],
    whoIsThisFor: ['IB DP students taking Physics HL or SL', 'Students targeting 6 or 7'],
    curriculum: [{ label: 'Module 1', title: 'Mechanics and Fields' }, { label: 'Module 2', title: 'Waves, Thermal and Atomic Physics' }, { label: 'Module 3', title: 'Exam Practice and IA Support' }],
    faqs: [{ question: 'Do you support the Internal Assessment?', answer: 'Yes. We help with topic selection, method design, data analysis and write-up feedback.' }],
  },
  {
    ...shared,
    title: 'IGCSE & A Level',
    slug: 'igcse-a-level',
    category: 'Cambridge',
    subCategory: 'IGCSE / A Level',
    shortDescription: 'Curriculum-focused teaching with structured problem solving.',
    heroHeadline: 'Structured problem solving for Cambridge success',
    keywords: ['IGCSE tutor', 'A Level Physics', 'Cambridge mentoring'],
    highlights: [{ label: 'Boards', value: 'Cambridge' }, { label: 'Format', value: '1:1 Live' }, { label: 'Practice', value: 'Past-paper led' }],
    whatYouWillLearn: ['Syllabus-aligned concept clarity', 'Structured working and mark-scheme awareness', 'Timed paper practice'],
    whoIsThisFor: ['IGCSE and AS/A Level students'],
  },
  {
    ...shared,
    title: 'SAT & AP',
    slug: 'sat-ap',
    category: 'College Prep',
    subCategory: 'SAT / AP',
    shortDescription: 'Exam strategy, timed practice and targeted performance improvement.',
    heroHeadline: 'Purposeful practice for SAT and AP scores that move',
    keywords: ['SAT prep', 'AP Physics tutor', 'college admissions mentoring'],
    highlights: [{ label: 'Exams', value: 'SAT + AP' }, { label: 'Practice', value: 'Timed' }, { label: 'Tracking', value: 'Weekly' }],
    whatYouWillLearn: ['Section-wise strategy', 'Timed practice and error analysis', 'AP content mastery'],
    whoIsThisFor: ['Students applying to universities abroad', 'AP candidates'],
  },
  {
    ...shared,
    title: 'JEE, NEET & CBSE',
    slug: 'jee-neet-cbse',
    category: 'Competitive',
    subCategory: 'JEE / NEET / CBSE',
    shortDescription: 'Strong fundamentals followed by systematic exam-level practice.',
    heroHeadline: 'Fundamentals first, exam-level practice next',
    keywords: ['JEE Physics', 'NEET Physics', 'CBSE mentoring'],
    highlights: [{ label: 'Exams', value: 'JEE + NEET + CBSE' }, { label: 'Approach', value: 'Fundamentals first' }, { label: 'Tests', value: 'Weekly' }],
    whatYouWillLearn: ['Concept foundations', 'Multi-step problem solving', 'Chapter-wise and full-length tests'],
    whoIsThisFor: ['Class 9-12 students', 'JEE and NEET aspirants'],
  },
];

const categories = [
  { name: 'International', description: 'IB Diploma programmes' },
  { name: 'Cambridge', description: 'IGCSE and A Level programmes' },
  { name: 'College Prep', description: 'SAT and AP programmes' },
  { name: 'Competitive', description: 'JEE, NEET and CBSE programmes' },
];

const run = async (): Promise<void> => {
  await connectDB();
  for (const category of categories) {
    await CourseCategory.findOneAndUpdate(
      { name: category.name },
      { $set: { ...category, slug: category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } },
      { upsert: true, new: true },
    );
  }
  for (const program of programs) {
    await Course.findOneAndUpdate({ slug: program.slug }, { $set: program }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(`Seeded ${programs.length} Zenith Learning programmes.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed to seed programmes:', error);
  await mongoose.disconnect();
  process.exit(1);
});
