export const NODE_TYPES = ['folder', 'page'] as const;

export const NODE_STATUSES = ['draft', 'published', 'archived'] as const;

/** What a folder does when someone visits its public URL. */
export const FOLDER_BEHAVIORS = ['landing', 'redirect', 'structural'] as const;

export const PAGE_LAYOUTS = ['standard', 'landing', 'article', 'directory', 'sidebar'] as const;

export const PAGE_WIDTHS = ['narrow', 'normal', 'wide'] as const;

export const CHILD_DISPLAYS = ['none', 'list', 'cards'] as const;

export const TWITTER_CARDS = ['summary', 'summary_large_image'] as const;

export const CHANGE_FREQUENCIES = [
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
] as const;

export const NODE_SORT_FIELDS = ['order', 'title', 'updatedAt', 'createdAt'] as const;

export const BULK_ACTIONS = [
  'publish',
  'unpublish',
  'showInNavigation',
  'hideFromNavigation',
  'delete',
] as const;

/**
 * Root slugs that already belong to application routes. Single source of
 * truth: validation is the only consumer, so a new static route only needs
 * adding here.
 */
export const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'dashboard',
  'rbac',
  'login',
  'logout',
  'register',
  'about-us',
  'blog',
  'careerx',
  'contact-us',
  'course',
  'creator',
  'faqs',
  'free-resourses',
  'lead',
  'mock-tests',
  'privacy-policy',
  'profile',
  'pyqs',
  'qna',
  'terms-conditions',
  'preview-frame',
  'sitemap',
  'sitemaps',
  'robots',
  'favicon',
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export const MAX_SLUG_LENGTH = 100;
export const MAX_CONTENT_LENGTH = 2_000_000;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_BULK_IDS = 200;

export const PAGE_ERROR_CODES = {
  NOT_FOUND: 'NODE_NOT_FOUND',
  PARENT_NOT_FOUND: 'INVALID_PARENT',
  SLUG_CONFLICT: 'SLUG_CONFLICT',
  SLUG_RESERVED: 'SLUG_RESERVED',
  SLUG_INVALID: 'SLUG_INVALID',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  NODE_HAS_CHILDREN: 'NODE_HAS_CHILDREN',
  INVALID_REORDER: 'INVALID_REORDER',
  INVALID_HIERARCHY: 'INVALID_HIERARCHY',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
} as const;
