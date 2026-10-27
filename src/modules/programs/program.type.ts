// program.type.ts
import { HydratedDocument } from 'mongoose';

export interface IAssetFile {
  /** Relative CDN path (new records). */
  path?: string;
  /** Legacy full URL (pre-S3 records). */
  url?: string;
  publicId: string;
}

export interface IModuleLesson {
  title: string;
  duration?: string;
}

export interface IModule {
  title: string;
  lessons: IModuleLesson[];
}

export interface IInstructor {
  name: string;
  image?: IAssetFile;
  bio?: string;
}

export interface IProgram {
  // Basic Information
  title: string;
  slug: string;
  category: string;
  subCategory?: string;
  shortDescription: string;
  fullDescription: string;

  // Course Details
  duration: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  language: string;
  mode: 'Online' | 'Offline' | 'Hybrid';
  certification: boolean;

  // Pricing
  price: number;
  discountedPrice: number;
  currency: string;

  // Media
  thumbnail: IAssetFile;
  bannerImage?: IAssetFile;

  // Curriculum
  modules: IModule[];

  // Learning Outcomes
  skillsYouWillLearn: string[];
  toolsCovered: string[];

  // Eligibility
  prerequisites: string[];
  targetAudience: string[];

  // Career
  careerOpportunities: string[];
  averageSalaryRange?: string;

  // Instructor
  instructor: IInstructor;

  // Placement
  placementSupport: boolean;
  internshipIncluded: boolean;
  jobAssistance: boolean;

  // SEO
  metaTitle?: string;
  metaDescription?: string;
  keywords: string[];

  // Statistics
  enrolledStudents: number;
  rating: number;
  totalReviews: number;

  // Status
  featured: boolean;
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type ProgramDocument = HydratedDocument<IProgram>;
