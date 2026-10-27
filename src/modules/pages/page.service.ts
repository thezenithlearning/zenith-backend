import type { QueryFilter } from 'mongoose';

import { ENV } from '../../config/env.js';

import { RESERVED_ROOT_SLUGS } from './page.constants.js';
import { toNodeDto, type NodeDto } from './page.dto.js';
import { PageError } from './page.error.js';
import {
  ancestorsFromMap,
  assertCanMove,
  buildPath,
  buildPaths,
  collectDescendantIds,
  loadAncestorMap,
  type NodeLoader,
} from './page.hierarchy.js';
import { pageRepository } from './page.repository.js';
import { sanitizeContent } from './page.sanitize.js';
import { normalizeSections } from './page.sections.js';
import { breadcrumbLabel } from './page.seo.js';
import type {
  BreadcrumbItem,
  BulkAction,
  CreateNodeInput,
  ListNodesQuery,
  MoveNodeInput,
  IPageNode,
  PageNodeDocument,
  ReorderInput,
  UpdateNodeInput,
} from './page.type.js';
import { escapeRegex, findFreeSlug, isDuplicateKeyError, slugifyTitle } from './page.utils.js';

/** Storage adapter handed to the pure hierarchy algorithms. */
export const nodeLoader: NodeLoader<PageNodeDocument> = {
  loadMany: (ids) => pageRepository.findManyByIds(ids),

  loadAncestorsOf: (ids) => pageRepository.findAncestorsOf(ids),

  async childIdsOf(parentIds) {
    const children = await pageRepository.find({ parent: { $in: parentIds } });

    return children.map((child) => String(child._id));
  },
};

export interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

export interface NodeImpact {
  directChildren: number;
  descendants: number;
}

/** Flattens { seo: { title } } into { "seo.title": ... } so partial section updates keep the other fields. */
function flattenSections(input: UpdateNodeInput): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;

    if (key === 'seo' || key === 'appearance' || key === 'navigation') {
      for (const [field, fieldValue] of Object.entries(value as object)) {
        if (fieldValue !== undefined) {
          changes[`${key}.${field}`] = fieldValue;
        }
      }
    } else {
      changes[key] = value;
    }
  }

  return changes;
}

class PageService {
  /* -------------------------------------------------------------- reads */

  async list(query: ListNodesQuery): Promise<{
    items: NodeDto[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const filter: QueryFilter<IPageNode> = {};

    if (query.parentId === 'root') filter.parent = null;
    else if (query.parentId) filter.parent = query.parentId;

    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.navigation !== undefined) filter['navigation.showInNavigation'] = query.navigation;
    if (query.indexed !== undefined) filter['seo.robotsIndex'] = query.indexed;

    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');

      filter.$or = [{ title: pattern }, { slug: pattern }];
    }

    const direction = query.sortOrder === 'asc' ? 1 : -1;

    const [nodes, total] = await Promise.all([
      pageRepository.find(filter, {
        sort: { [query.sortBy]: direction, _id: 1 },
        skip: (query.page - 1) * query.limit,
        limit: query.limit,
      }),
      pageRepository.count(filter),
    ]);

    return {
      items: await this.toDtos(nodes),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getById(id: string): Promise<{
    node: NodeDto;
    breadcrumbs: BreadcrumbItem[];
  }> {
    const node = await this.requireNode(id);
    const map = await loadAncestorMap([node], nodeLoader);
    const ancestors = ancestorsFromMap(node, map);
    const counts = await pageRepository.countChildrenByParent([node._id]);

    return {
      node: toNodeDto(node, buildPath(ancestors, node), counts.get(id) ?? 0, {
        includeContent: true,
      }),
      breadcrumbs: this.adminBreadcrumbs(ancestors),
    };
  }

  /** How many nodes a slug change, move or delete of this node would touch. */
  async getImpact(id: string): Promise<NodeImpact> {
    await this.requireNode(id);

    const descendants = await collectDescendantIds(id, nodeLoader);
    const directChildren = await pageRepository.count({ parent: id });

    return { directChildren, descendants: descendants.length };
  }

  async summary() {
    const [folders, pages, published, draft, archived, noindex] = await Promise.all([
      pageRepository.count({ type: 'folder' }),
      pageRepository.count({ type: 'page' }),
      pageRepository.count({ status: 'published' }),
      pageRepository.count({ status: 'draft' }),
      pageRepository.count({ status: 'archived' }),
      pageRepository.count({ 'seo.robotsIndex': false }),
    ]);

    return { folders, pages, total: folders + pages, published, draft, archived, noindex };
  }

  /* ------------------------------------------------------------- writes */

  async create(input: CreateNodeInput): Promise<NodeDto> {
    if (input.parentId) {
      await this.requireParent(input.parentId);
    }

    const slug = this.resolveSlug(input.slug, input.title);

    this.assertSlugAllowed(input.parentId, slug);

    const raw = ENV.PAGES_ALLOW_RAW_HTML;
    const order = input.order ?? (await pageRepository.maxOrder(input.parentId)) + 1;
    const status = input.status ?? 'draft';

    try {
      const created = await pageRepository.create({
        title: input.title,
        slug,
        parent: input.parentId as never,
        type: input.type,
        status,
        order,
        heading: input.heading ?? '',
        summary: input.summary ?? '',
        html: raw ? (input.html ?? '') : sanitizeContent(input.html ?? ''),
        sections: normalizeSections(input.sections ?? [], raw),
        folderBehavior: input.folderBehavior ?? 'landing',
        seo: input.seo as never,
        appearance: input.appearance as never,
        navigation: input.navigation as never,
        publishAt: input.publishAt ?? null,
        unpublishAt: input.unpublishAt ?? null,
        publishedAt: status === 'published' ? new Date() : null,
      });

      return (await this.toDtos([created]))[0];
    } catch (error) {
      throw this.mapWriteError(error, slug);
    }
  }

  async update(id: string, input: UpdateNodeInput): Promise<NodeDto> {
    const existing = await this.requireNode(id);

    const changes = flattenSections(input);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      this.assertSlugAllowed(existing.parent ? String(existing.parent) : null, input.slug);
    }

    const raw = ENV.PAGES_ALLOW_RAW_HTML;

    if (input.html !== undefined) {
      changes.html = raw ? input.html : sanitizeContent(input.html);
    }

    if (input.sections !== undefined) {
      changes.sections = normalizeSections(input.sections, raw);
    }

    if (input.status === 'published' && !existing.publishedAt) {
      changes.publishedAt = new Date();
    }

    try {
      const updated = await pageRepository.update(id, changes);

      if (!updated) throw PageError.notFound(id);

      return (await this.toDtos([updated], { includeContent: true }))[0];
    } catch (error) {
      throw this.mapWriteError(error, input.slug);
    }
  }

  async move(id: string, input: MoveNodeInput): Promise<NodeDto> {
    const node = await this.requireNode(id);

    // Backend-enforced; the UI only mirrors this rule.
    await assertCanMove(id, input.parentId, nodeLoader);

    const currentParent = node.parent ? String(node.parent) : null;

    if (input.parentId === currentParent) {
      return (await this.toDtos([node], { includeContent: true }))[0];
    }

    this.assertSlugAllowed(input.parentId, node.slug);

    const clash = await pageRepository.findChild(input.parentId, node.slug);

    if (clash && String(clash._id) !== id) {
      throw PageError.slugConflict(node.slug);
    }

    const order = (await pageRepository.maxOrder(input.parentId)) + 1;

    try {
      const moved = await pageRepository.update(id, { parent: input.parentId, order });

      if (!moved) throw PageError.notFound(id);

      return (await this.toDtos([moved], { includeContent: true }))[0];
    } catch (error) {
      throw this.mapWriteError(error, node.slug);
    }
  }

  async reorder(input: ReorderInput): Promise<void> {
    const siblings = await pageRepository.find({ parent: input.parentId });

    const siblingIds = new Set(siblings.map((node) => String(node._id)));
    const requested = new Set(input.orderedIds);

    if (requested.size !== input.orderedIds.length) {
      throw PageError.invalidReorder('The ordered list contains duplicate ids');
    }

    if (siblingIds.size !== requested.size || [...requested].some((id) => !siblingIds.has(id))) {
      throw PageError.invalidReorder(
        'The ordered list must contain exactly the pages that share this parent',
      );
    }

    await pageRepository.bulkSetOrder(input.orderedIds.map((id, index) => ({ id, order: index })));
  }

  async delete(id: string, cascade: boolean): Promise<{ deleted: number }> {
    await this.requireNode(id);

    const directChildren = await pageRepository.count({ parent: id });

    if (directChildren > 0 && !cascade) {
      throw PageError.hasChildren(directChildren);
    }

    const descendants = directChildren > 0 ? await collectDescendantIds(id, nodeLoader) : [];

    const result = await pageRepository.deleteMany([id, ...descendants]);

    return { deleted: result.deletedCount };
  }

  /** Copies one node (not its subtree) as a draft next to the original. */
  async duplicate(id: string): Promise<NodeDto> {
    const source = await this.requireNode(id);
    const parent = source.parent ? String(source.parent) : null;

    const slug = await findFreeSlug(source.slug, (candidate) =>
      pageRepository.exists({ parent, slug: candidate }),
    );

    try {
      const created = await pageRepository.create({
        title: `${source.title} (Copy)`.slice(0, 200),
        slug,
        parent: source.parent,
        type: source.type,
        status: 'draft',
        order: (await pageRepository.maxOrder(parent)) + 1,
        heading: source.heading,
        summary: source.summary,
        html: source.html,
        sections: source.sections ?? [],
        folderBehavior: source.folderBehavior,
        seo: { ...source.seo, canonicalUrl: '' },
        appearance: source.appearance,
        navigation: source.navigation,
        publishAt: null,
        unpublishAt: null,
        publishedAt: null,
      });

      return (await this.toDtos([created]))[0];
    } catch (error) {
      throw this.mapWriteError(error, slug);
    }
  }

  async bulk(action: BulkAction, ids: string[], cascade: boolean): Promise<BulkResult> {
    const found = await pageRepository.findManyByIds(ids);
    const foundIds = new Set(found.map((node) => String(node._id)));

    const failed: BulkResult['failed'] = ids
      .filter((id) => !foundIds.has(id))
      .map((id) => ({ id, message: 'Page not found' }));

    const targets = [...foundIds];

    if (action === 'delete') {
      const succeeded: string[] = [];

      for (const id of targets) {
        try {
          await this.delete(id, cascade);
          succeeded.push(id);
        } catch (error) {
          failed.push({
            id,
            message: error instanceof Error ? error.message : 'Delete failed',
          });
        }
      }

      return { succeeded, failed };
    }

    if (action === 'publish') {
      await pageRepository.updateMany(
        { _id: { $in: targets }, publishedAt: null },
        { publishedAt: new Date() },
      );
      await pageRepository.updateMany({ _id: { $in: targets } }, { status: 'published' });
    } else if (action === 'unpublish') {
      await pageRepository.updateMany({ _id: { $in: targets } }, { status: 'draft' });
    } else {
      await pageRepository.updateMany(
        { _id: { $in: targets } },
        { 'navigation.showInNavigation': action === 'showInNavigation' },
      );
    }

    return { succeeded: targets, failed };
  }

  /* ------------------------------------------------------------ helpers */

  private async requireNode(id: string): Promise<PageNodeDocument> {
    const node = await pageRepository.findById(id);

    if (!node) throw PageError.notFound(id);

    return node;
  }

  private async requireParent(id: string): Promise<void> {
    const parent = await pageRepository.findById(id);

    if (!parent) throw PageError.parentNotFound(id);
  }

  private resolveSlug(slug: string | undefined, title: string): string {
    if (slug) return slug;

    const generated = slugifyTitle(title);

    if (!generated) {
      throw PageError.slugInvalid(
        'A slug could not be generated from the title. Enter one manually.',
      );
    }

    return generated;
  }

  /** Reserved slugs only matter at the top level, where they meet real routes. */
  private assertSlugAllowed(parentId: string | null, slug: string): void {
    if (parentId === null && RESERVED_ROOT_SLUGS.has(slug)) {
      throw PageError.slugReserved(slug);
    }
  }

  private mapWriteError(error: unknown, slug?: string): unknown {
    if (isDuplicateKeyError(error)) {
      return PageError.slugConflict(slug ?? 'this slug');
    }

    return error;
  }

  private adminBreadcrumbs(ancestors: PageNodeDocument[]): BreadcrumbItem[] {
    return ancestors.map((ancestor, index) => ({
      id: String(ancestor._id),
      label: breadcrumbLabel(ancestor),
      path: buildPath(ancestors.slice(0, index), ancestor),
    }));
  }

  /** DTOs with public paths and child counts, loaded in batches (no N+1). */
  private async toDtos(
    nodes: PageNodeDocument[],
    options: { includeContent?: boolean } = {},
  ): Promise<NodeDto[]> {
    if (nodes.length === 0) return [];

    const [paths, counts] = await Promise.all([
      buildPaths(nodes, nodeLoader),
      pageRepository.countChildrenByParent(nodes.map((node) => node._id)),
    ]);

    return nodes.map((node) =>
      toNodeDto(
        node,
        paths.get(String(node._id)) ?? `/${node.slug}`,
        counts.get(String(node._id)) ?? 0,
        options,
      ),
    );
  }
}

export const pageService = new PageService();
