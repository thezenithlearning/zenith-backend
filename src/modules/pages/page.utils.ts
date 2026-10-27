import { MAX_SLUG_LENGTH, SLUG_PATTERN } from './page.constants.js';

/** "RBI Grade B (2026)!" -> "rbi-grade-b-2026". Empty string if nothing usable. */
export function slugifyTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, '');
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/** ["a","b"] -> "/a/b" ; [] -> "/" */
export function joinPath(slugs: string[]): string {
  return `/${slugs.join('/')}`;
}

/** "/a/b/" or "a//b" -> ["a","b"] */
export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Appends "-copy", "-copy-2"... until `isTaken` says the slug is free. */
export async function findFreeSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  let candidate = `${base}-copy`.slice(0, MAX_SLUG_LENGTH);
  let counter = 2;

  while (await isTaken(candidate)) {
    const suffix = `-copy-${counter++}`;

    candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }

  return candidate;
}
