import type { Types } from 'mongoose';

import type { Section } from './page.sections.js';

import type {
  BULK_ACTIONS,
  CHANGE_FREQUENCIES,
  CHILD_DISPLAYS,
  FOLDER_BEHAVIORS,
  NODE_SORT_FIELDS,
  NODE_STATUSES,
  NODE_TYPES,
  PAGE_LAYOUTS,
  PAGE_WIDTHS,
  TWITTER_CARDS,
} from './page.constants.js';

export type NodeType = (typeof NODE_TYPES)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type FolderBehavior = (typeof FOLDER_BEHAVIORS)[number];
export type PageLayout = (typeof PAGE_LAYOUTS)[number];
export type PageWidth = (typeof PAGE_WIDTHS)[number];
export type ChildDisplay = (typeof CHILD_DISPLAYS)[number];
export type TwitterCard = (typeof TWITTER_CARDS)[number];
export type ChangeFrequency = (typeof CHANGE_FREQUENCIES)[number];
export type NodeSortField = (typeof NODE_SORT_FIELDS)[number];
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface SeoSettings {
  title: string;
  description: string;
  canonicalUrl: string;
  robotsIndex: boolean;
  robotsFollow: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterCard: TwitterCard;
  keywords: string[];
  breadcrumbTitle: string;
  sitemapInclude: boolean;
  sitemapPriority: number | null;
  sitemapChangeFrequency: ChangeFrequency | null;
}

export interface AppearanceSettings {
  layout: PageLayout;
  pageWidth: PageWidth;
  showHeading: boolean;
  showBreadcrumbs: boolean;
  coverImageUrl: string;
  coverImageAlt: string;
  childDisplay: ChildDisplay;
  /** Heading above the child-page list. Empty = no heading. */
  childrenTitle: string;
}

export interface NavigationSettings {
  showInNavigation: boolean;
}

/**
 * One self-referencing node. Root / parent / child / leaf are derived from
 * `parent`, never stored.
 */
export interface IPageNode {
  title: string;
  slug: string;
  parent: Types.ObjectId | null;
  type: NodeType;
  status: NodeStatus;
  order: number;

  heading: string;
  summary: string;
  html: string;
  sections: Section[];
  folderBehavior: FolderBehavior;

  seo: SeoSettings;
  appearance: AppearanceSettings;
  navigation: NavigationSettings;

  publishAt: Date | null;
  unpublishAt: Date | null;
  publishedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface PageNodeDocument extends IPageNode {
  _id: Types.ObjectId;
}

export interface BreadcrumbItem {
  id: string;
  label: string;
  /** Public path ("/a/b") or null when the node has no public page. */
  path: string | null;
}

export type CreateNodeInput = {
  title: string;
  type: NodeType;
  parentId: string | null;
  slug?: string;
  status?: NodeStatus;
  order?: number;
  heading?: string;
  summary?: string;
  html?: string;
  sections?: Section[];
  folderBehavior?: FolderBehavior;
  seo?: Partial<SeoSettings>;
  appearance?: Partial<AppearanceSettings>;
  navigation?: Partial<NavigationSettings>;
  publishAt?: Date | null;
  unpublishAt?: Date | null;
};

export type UpdateNodeInput = Partial<Omit<CreateNodeInput, 'parentId' | 'type'>>;

export interface MoveNodeInput {
  parentId: string | null;
}

export interface ReorderInput {
  parentId: string | null;
  orderedIds: string[];
}

export interface ListNodesQuery {
  /** "root" = roots, an id = that node's children, undefined = anywhere. */
  parentId?: string | 'root';
  search?: string;
  type?: NodeType;
  status?: NodeStatus;
  navigation?: boolean;
  indexed?: boolean;
  page: number;
  limit: number;
  sortBy: NodeSortField;
  sortOrder: 'asc' | 'desc';
}
