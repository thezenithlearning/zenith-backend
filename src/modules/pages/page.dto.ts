import { ENV } from '../../config/env.js';

import type { Section } from './page.sections.js';
import type { PageNodeDocument } from './page.type.js';

export const SITE_URL = ENV.SITE_URL;

/** Visible to the public right now: published and inside its schedule. */
export function isLive(node: PageNodeDocument, now = new Date()): boolean {
  return (
    node.status === 'published' &&
    (!node.publishAt || node.publishAt <= now) &&
    (!node.unpublishAt || node.unpublishAt > now)
  );
}

export interface NodeDto {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  type: PageNodeDocument['type'];
  status: PageNodeDocument['status'];
  order: number;
  heading: string;
  summary: string;
  folderBehavior: PageNodeDocument['folderBehavior'];
  seo: PageNodeDocument['seo'];
  appearance: PageNodeDocument['appearance'];
  navigation: PageNodeDocument['navigation'];
  publishAt: Date | null;
  unpublishAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  path: string;
  publicUrl: string;
  isLive: boolean;
  childCount: number;
  /** Only present on single-node reads; lists omit the heavy body. */
  html?: string;
  sections?: Section[];
}

export function toNodeDto(
  node: PageNodeDocument,
  path: string,
  childCount: number,
  options: { includeContent?: boolean } = {},
): NodeDto {
  return {
    id: String(node._id),
    parentId: node.parent ? String(node.parent) : null,
    title: node.title,
    slug: node.slug,
    type: node.type,
    status: node.status,
    order: node.order,
    heading: node.heading,
    summary: node.summary,
    folderBehavior: node.folderBehavior,
    seo: node.seo,
    appearance: node.appearance,
    navigation: node.navigation,
    publishAt: node.publishAt,
    unpublishAt: node.unpublishAt,
    publishedAt: node.publishedAt,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    path,
    publicUrl: `${SITE_URL.replace(/\/+$/, '')}${path}`,
    isLive: isLive(node),
    childCount,
    ...(options.includeContent ? { html: node.html, sections: node.sections ?? [] } : {}),
  };
}
