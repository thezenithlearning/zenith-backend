import { ENV } from '../config/env.js';

const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * Old deployments served media through the API (`<host>/api/v1/assets/<key>`).
 * Stored URLs and rich-text content may still contain them, so they are mapped
 * onto the CDN wherever they are read.
 */
const LEGACY_API_ASSET_URL = /https?:\/\/[^\s"'<>()]+?\/api\/v1\/assets\//gi;
const LEGACY_API_ASSET_PREFIX = /^https?:\/\/[^/]+\/api\/v1\/assets\//i;

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const encodeAssetPath = (value: string): string =>
  trimSlashes(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(safeDecodeURIComponent(segment)))
    .join('/');

const getLegacyS3Path = (value: string): string | undefined => {
  if (!ABSOLUTE_URL.test(value)) return undefined;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const bucket = ENV.AWS_BUCKET_NAME.toLowerCase();
    const region = ENV.AWS_REGION.toLowerCase();

    if (
      hostname === `${bucket}.s3.${region}.amazonaws.com` ||
      hostname === `${bucket}.s3.amazonaws.com`
    ) {
      return safeDecodeURIComponent(trimSlashes(url.pathname));
    }

    if (hostname === `s3.${region}.amazonaws.com` || hostname === 's3.amazonaws.com') {
      const pathname = trimSlashes(url.pathname);
      const bucketPrefix = `${ENV.AWS_BUCKET_NAME}/`;

      if (pathname.startsWith(bucketPrefix)) {
        return safeDecodeURIComponent(pathname.slice(bucketPrefix.length));
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const getLegacyApiPath = (value: string): string | undefined => {
  const match = LEGACY_API_ASSET_PREFIX.exec(value);

  if (!match) return undefined;

  return safeDecodeURIComponent(trimSlashes(value.slice(match[0].length).split(/[?#]/)[0]));
};

/**
 * Convert a CDN URL (or a legacy API / S3 URL) back into an object key.
 * Absolute URLs belonging to another host remain unchanged.
 */
export const stripAssetBase = (value?: string | null): string => {
  if (!value) return '';

  const cdnPrefix = `${ENV.CDN_BASE_URL}/`;

  if (value.startsWith(cdnPrefix)) {
    return safeDecodeURIComponent(trimSlashes(value.slice(cdnPrefix.length).split(/[?#]/)[0]));
  }

  return getLegacyApiPath(value) ?? getLegacyS3Path(value) ?? value;
};

/**
 * Resolve an object key against the CDN base URL.
 *
 * Legacy API and S3 URLs are rewritten onto the CDN; genuinely external
 * absolute URLs are preserved.
 */
export const resolveAssetUrl = (value?: string | null): string => {
  if (!value) return '';

  if (value.startsWith(`${ENV.CDN_BASE_URL}/`)) {
    return value;
  }

  const legacyKey = getLegacyApiPath(value) ?? getLegacyS3Path(value);

  if (legacyKey) {
    return `${ENV.CDN_BASE_URL}/${encodeAssetPath(legacyKey)}`;
  }

  if (ABSOLUTE_URL.test(value)) {
    return value;
  }

  return `${ENV.CDN_BASE_URL}/${encodeAssetPath(value)}`;
};

const isAssetObject = (object: Record<string, unknown>): boolean =>
  typeof object.storageKey === 'string' ||
  typeof object.publicId === 'string' ||
  (typeof object.key === 'string' && typeof object.provider === 'string');

const firstNonEmptyString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

/**
 * Recursively clone a response and normalize asset subdocuments so the public
 * `url` is always derived from the stored key and the current CDN base URL.
 *
 * Canonical field:  storageKey (asset library records use `key`)
 * Legacy field supported during migration: publicId
 */
export const injectAssetUrls = <T>(payload: T): T => {
  const plain = JSON.parse(JSON.stringify(payload)) as unknown;
  const seen = new WeakSet<object>();
  const cdnPrefix = `${ENV.CDN_BASE_URL}/`;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      // Rewrite embedded legacy API URLs (e.g. inside rich-text HTML).
      return node.includes('/api/v1/assets/')
        ? node.replace(LEGACY_API_ASSET_URL, cdnPrefix)
        : node;
    }

    if (node === null || typeof node !== 'object') return node;
    if (seen.has(node as object)) return node;

    seen.add(node as object);

    if (Array.isArray(node)) {
      return node.map(walk);
    }

    const object = node as Record<string, unknown>;

    if (isAssetObject(object)) {
      const existingUrl = firstNonEmptyString(object.url);

      const storageKey = firstNonEmptyString(
        object.storageKey,
        object.key,
        object.publicId,
        object.path,
        existingUrl ? stripAssetBase(existingUrl) : undefined,
      );

      if (storageKey && !ABSOLUTE_URL.test(storageKey)) {
        const normalizedKey = trimSlashes(storageKey);

        if (typeof object.key !== 'string') object.storageKey = normalizedKey;
        object.path = `/${normalizedKey}`;
        object.url = resolveAssetUrl(normalizedKey);
      } else if (existingUrl) {
        object.url = resolveAssetUrl(existingUrl);
      }
    }

    for (const key of Object.keys(object)) {
      object[key] = walk(object[key]);
    }

    return object;
  };

  return walk(plain) as T;
};
