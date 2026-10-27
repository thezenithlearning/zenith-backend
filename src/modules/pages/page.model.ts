import mongoose, { Schema, model, type Model } from 'mongoose';

import {
  CHANGE_FREQUENCIES,
  CHILD_DISPLAYS,
  FOLDER_BEHAVIORS,
  NODE_STATUSES,
  NODE_TYPES,
  PAGE_LAYOUTS,
  PAGE_WIDTHS,
  TWITTER_CARDS,
} from './page.constants.js';
import type { IPageNode } from './page.type.js';

const seoSchema = new Schema(
  {
    title: { type: String, default: '', trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 320 },
    canonicalUrl: { type: String, default: '', trim: true, maxlength: 500 },
    robotsIndex: { type: Boolean, default: true },
    robotsFollow: { type: Boolean, default: true },
    ogTitle: { type: String, default: '', trim: true, maxlength: 120 },
    ogDescription: { type: String, default: '', trim: true, maxlength: 320 },
    ogImage: { type: String, default: '', trim: true, maxlength: 500 },
    twitterCard: { type: String, enum: TWITTER_CARDS, default: 'summary_large_image' },
    keywords: { type: [String], default: [] },
    breadcrumbTitle: { type: String, default: '', trim: true, maxlength: 120 },
    sitemapInclude: { type: Boolean, default: true },
    sitemapPriority: { type: Number, min: 0, max: 1, default: null },
    sitemapChangeFrequency: { type: String, enum: [...CHANGE_FREQUENCIES, null], default: null },
  },
  { _id: false },
);

const appearanceSchema = new Schema(
  {
    layout: { type: String, enum: PAGE_LAYOUTS, default: 'standard' },
    pageWidth: { type: String, enum: PAGE_WIDTHS, default: 'normal' },
    showHeading: { type: Boolean, default: true },
    showBreadcrumbs: { type: Boolean, default: true },
    coverImageUrl: { type: String, default: '', trim: true, maxlength: 500 },
    coverImageAlt: { type: String, default: '', trim: true, maxlength: 300 },
    childDisplay: { type: String, enum: CHILD_DISPLAYS, default: 'none' },
    childrenTitle: { type: String, default: '', trim: true, maxlength: 120 },
  },
  { _id: false },
);

const navigationSchema = new Schema(
  { showInNavigation: { type: Boolean, default: true } },
  { _id: false },
);

const pageNodeSchema = new Schema<IPageNode>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },

    // Always stored explicitly (null for roots) so the unique index below
    // treats every root as the same "null" sibling group.
    parent: { type: Schema.Types.ObjectId, ref: 'PageNode', default: null },

    type: { type: String, enum: NODE_TYPES, required: true },
    status: { type: String, enum: NODE_STATUSES, default: 'draft' },
    order: { type: Number, default: 0 },

    heading: { type: String, default: '', trim: true, maxlength: 200 },
    summary: { type: String, default: '', trim: true, maxlength: 1000 },
    // Legacy single body. New pages use `sections`; kept so old pages still render.
    html: { type: String, default: '' },
    // Ordered page-builder sections (validated + sanitised in the service).
    // Mixed array: structure is enforced by zod at the API boundary.
    sections: { type: Schema.Types.Mixed as never, default: () => [] },
    folderBehavior: { type: String, enum: FOLDER_BEHAVIORS, default: 'landing' },

    seo: { type: seoSchema, default: () => ({}) },
    appearance: { type: appearanceSchema, default: () => ({}) },
    navigation: { type: navigationSchema, default: () => ({}) },

    publishAt: { type: Date, default: null },
    unpublishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Sibling slug uniqueness is enforced by the database, not just validation.
pageNodeSchema.index({ parent: 1, slug: 1 }, { unique: true });
pageNodeSchema.index({ parent: 1, order: 1 });
pageNodeSchema.index({ status: 1, parent: 1 });
pageNodeSchema.index({ title: 1 });

export const PageNode: Model<IPageNode> =
  (mongoose.models.PageNode as Model<IPageNode> | undefined) ??
  model<IPageNode>('PageNode', pageNodeSchema);
