import { SITE_URL } from './page.dto.js';
import { PageError } from './page.error.js';
import { ancestorsFromMap, buildPath, loadAncestorMap } from './page.hierarchy.js';
import { pageRepository, publicFilter } from './page.repository.js';
import { nodeLoader } from './page.service.js';
import {
  breadcrumbLabel,
  buildBreadcrumbJsonLd,
  resolveSeo,
  type ResolvedSeo,
} from './page.seo.js';
import { publicSections, type Section } from './page.sections.js';
import type { BreadcrumbItem, PageNodeDocument } from './page.type.js';
import { joinPath, splitPath } from './page.utils.js';

export interface PublicChild {
  id: string;
  title: string;
  summary: string;
  type: PageNodeDocument['type'];
  path: string;
  coverImageUrl: string;
}

/** Everything the renderer needs and nothing administrative. */
export interface PublicPageView {
  id: string;
  title: string;
  heading: string;
  summary: string;
  html: string;
  sections: Section[];
  type: PageNodeDocument['type'];
  folderBehavior: PageNodeDocument['folderBehavior'];
  appearance: PageNodeDocument['appearance'];
  path: string;
  seo: ResolvedSeo;
  breadcrumbs: BreadcrumbItem[];
  breadcrumbJsonLd: Record<string, unknown>;
  children: PublicChild[];
  updatedAt: Date;
}

export type ResolveResult =
  { kind: 'page'; view: PublicPageView } | { kind: 'redirect'; to: string };

export interface SitemapEntry {
  path: string;
  lastModified: Date;
  priority: number | null;
  changeFrequency: string | null;
}

/** A node has its own public page unless it is a purely structural folder. */
const hasPublicPage = (node: PageNodeDocument) =>
  !(node.type === 'folder' && node.folderBehavior === 'structural');

class PagePublicService {
  /**
   * Resolves "/a/b/c" one segment at a time: each segment must be a LIVE
   * child of the previous node. A slug that exists in another branch can
   * never match, and an unpublished ancestor hides its whole subtree.
   */
  async resolve(rawPath: string): Promise<ResolveResult> {
    const segments = splitPath(rawPath);

    if (segments.length === 0) {
      throw PageError.pathNotFound('/');
    }

    // Slugs are lowercase; send mixed-case requests to the canonical URL.
    const lowered = segments.map((segment) => segment.toLowerCase());

    if (lowered.some((segment, index) => segment !== segments[index])) {
      return { kind: 'redirect', to: joinPath(lowered) };
    }

    const now = new Date();
    const chain: PageNodeDocument[] = [];

    let parent: string | null = null;

    for (const slug of segments) {
      const node: PageNodeDocument | null = await pageRepository.findChild(
        parent,
        slug,
        publicFilter(now),
      );

      if (!node) throw PageError.pathNotFound(rawPath);

      chain.push(node);
      parent = String(node._id);
    }

    const node = chain[chain.length - 1];
    const ancestors = chain.slice(0, -1);

    if (node.type === 'folder') {
      if (node.folderBehavior === 'structural') {
        throw PageError.pathNotFound(rawPath);
      }

      if (node.folderBehavior === 'redirect') {
        const first = await this.firstPublicChild(node);

        if (!first) throw PageError.pathNotFound(rawPath);

        return {
          kind: 'redirect',
          to: buildPath([...ancestors, node], first),
        };
      }
    }

    return { kind: 'page', view: await this.buildView(node, ancestors, now) };
  }

  /** Dashboard preview: same rendering, no publish checks. */
  async preview(id: string): Promise<PublicPageView> {
    const node = await pageRepository.findById(id);

    if (!node) throw PageError.notFound(id);

    const map = await loadAncestorMap([node], nodeLoader);

    return this.buildView(node, ancestorsFromMap(node, map), new Date());
  }

  async sitemap(): Promise<SitemapEntry[]> {
    const live = await pageRepository.find(publicFilter(), { sort: { order: 1 } });

    const childrenByParent = new Map<string | null, PageNodeDocument[]>();

    for (const node of live) {
      const key = node.parent ? String(node.parent) : null;

      childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), node]);
    }

    const entries: SitemapEntry[] = [];

    // Breadth-first from the roots: a node is only reachable (and listed)
    // when every ancestor is live too.
    let frontier: Array<{ node: PageNodeDocument; slugs: string[] }> = (
      childrenByParent.get(null) ?? []
    ).map((node) => ({ node, slugs: [node.slug] }));

    while (frontier.length > 0) {
      const next: typeof frontier = [];

      for (const { node, slugs } of frontier) {
        const listable =
          hasPublicPage(node) &&
          !(node.type === 'folder' && node.folderBehavior === 'redirect') &&
          node.seo.robotsIndex &&
          node.seo.sitemapInclude;

        if (listable) {
          entries.push({
            path: joinPath(slugs),
            lastModified: node.updatedAt,
            priority: node.seo.sitemapPriority,
            changeFrequency: node.seo.sitemapChangeFrequency,
          });
        }

        for (const child of childrenByParent.get(String(node._id)) ?? []) {
          next.push({ node: child, slugs: [...slugs, child.slug] });
        }
      }

      frontier = next;
    }

    return entries;
  }

  /* ------------------------------------------------------------ helpers */

  private async firstPublicChild(node: PageNodeDocument): Promise<PageNodeDocument | null> {
    const children = await pageRepository.find(
      { parent: node._id, ...publicFilter() },
      { sort: { order: 1 } },
    );

    return children.find(hasPublicPage) ?? null;
  }

  private async buildView(
    node: PageNodeDocument,
    ancestors: PageNodeDocument[],
    now: Date,
  ): Promise<PublicPageView> {
    const path = buildPath(ancestors, node);

    const breadcrumbs: BreadcrumbItem[] = [
      ...ancestors.map((ancestor, index) => ({
        id: String(ancestor._id),
        label: breadcrumbLabel(ancestor),
        path: hasPublicPage(ancestor) ? buildPath(ancestors.slice(0, index), ancestor) : null,
      })),
      { id: String(node._id), label: breadcrumbLabel(node), path },
    ];

    return {
      id: String(node._id),
      title: node.title,
      heading: node.heading || node.title,
      summary: node.summary,
      html: node.html,
      sections: publicSections(node.sections ?? []),
      type: node.type,
      folderBehavior: node.folderBehavior,
      appearance: node.appearance,
      path,
      seo: resolveSeo(node, ancestors, path, SITE_URL),
      breadcrumbs,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(breadcrumbs, SITE_URL),
      children: await this.publicChildren(node, path, now),
      updatedAt: node.updatedAt,
    };
  }

  private async publicChildren(
    node: PageNodeDocument,
    path: string,
    now: Date,
  ): Promise<PublicChild[]> {
    if (node.appearance.childDisplay === 'none') return [];

    const children = await pageRepository.find(
      { parent: node._id, ...publicFilter(now) },
      { sort: { order: 1 } },
    );

    return children.filter(hasPublicPage).map((child) => ({
      id: String(child._id),
      title: child.title,
      summary: child.summary,
      type: child.type,
      path: `${path}/${child.slug}`,
      coverImageUrl: child.appearance.coverImageUrl,
    }));
  }
}

export const pagePublicService = new PagePublicService();
