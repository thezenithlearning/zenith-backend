import type { BreadcrumbItem, IPageNode, SeoSettings, TwitterCard } from './page.type.js';

export interface ResolvedSeo {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  keywords: string[];
  openGraph: {
    title: string;
    description: string;
    image: string | null;
    type: 'website';
    url: string;
  };
  twitter: {
    card: TwitterCard;
    title: string;
    description: string;
    image: string | null;
  };
}

export type SeoSource = Pick<IPageNode, 'title' | 'heading' | 'summary' | 'seo' | 'appearance'>;

/** "/path" or a relative image becomes absolute against the site URL. */
export function toAbsoluteUrl(value: string, siteUrl: string): string {
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) return value;

  return `${siteUrl.replace(/\/+$/, '')}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function buildRobots(seo: Pick<SeoSettings, 'robotsIndex' | 'robotsFollow'>): string {
  return `${seo.robotsIndex ? 'index' : 'noindex'}, ${seo.robotsFollow ? 'follow' : 'nofollow'}`;
}

/**
 * Fallback chain (first non-empty wins):
 *   title        : seo.title -> title
 *   description  : seo.description -> summary
 *   og title     : seo.ogTitle -> seo title
 *   og desc      : seo.ogDescription -> description
 *   og image     : seo.ogImage -> cover image -> nearest ancestor's og/cover image
 *   canonical    : seo.canonicalUrl -> generated public URL
 */
export function resolveSeo(
  node: SeoSource,
  ancestors: SeoSource[],
  publicPath: string,
  siteUrl: string,
): ResolvedSeo {
  const title = node.seo.title || node.title;
  const description = node.seo.description || node.summary;

  const inheritedImage = [...ancestors]
    .reverse()
    .map((ancestor) => ancestor.seo.ogImage || ancestor.appearance.coverImageUrl)
    .find(Boolean);

  const image = node.seo.ogImage || node.appearance.coverImageUrl || inheritedImage || '';

  const absoluteImage = image ? toAbsoluteUrl(image, siteUrl) : null;
  const generatedUrl = toAbsoluteUrl(publicPath, siteUrl);
  const canonicalUrl = node.seo.canonicalUrl
    ? toAbsoluteUrl(node.seo.canonicalUrl, siteUrl)
    : generatedUrl;

  const ogTitle = node.seo.ogTitle || title;
  const ogDescription = node.seo.ogDescription || description;

  return {
    title,
    description,
    canonicalUrl,
    robots: buildRobots(node.seo),
    keywords: node.seo.keywords,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      image: absoluteImage,
      type: 'website',
      url: canonicalUrl,
    },
    twitter: {
      card: node.seo.twitterCard,
      title: ogTitle,
      description: ogDescription,
      image: absoluteImage,
    },
  };
}

/** Label priority: breadcrumbTitle -> title. */
export function breadcrumbLabel(node: Pick<IPageNode, 'title' | 'seo'>): string {
  return node.seo.breadcrumbTitle || node.title;
}

export function buildBreadcrumbJsonLd(
  items: BreadcrumbItem[],
  siteUrl: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(item.path ? { item: toAbsoluteUrl(item.path, siteUrl) } : {}),
    })),
  };
}
