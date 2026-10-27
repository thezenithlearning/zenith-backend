import { PAGE_ERROR_CODES } from './page.constants.js';
import { PageError } from './page.error.js';
import { joinPath } from './page.utils.js';

/**
 * Pure tree algorithms. They only need the two storage-agnostic questions
 * below, so they are unit-testable with an in-memory map and never depend on
 * a depth limit: every walk is iterative and guarded by a visited-set.
 */

export interface TreeNodeRef {
  _id: { toString(): string };
  slug: string;
  title: string;
  parent: { toString(): string } | null;
}

export interface NodeLoader<T extends TreeNodeRef = TreeNodeRef> {
  /** Load nodes by id; missing ids are simply absent from the result. */
  loadMany(ids: string[]): Promise<T[]>;
  /** Direct children ids of every given parent. */
  childIdsOf(parentIds: string[]): Promise<string[]>;
  /**
   * Optional fast path: every ancestor of the given nodes in ONE round trip
   * (e.g. $graphLookup) instead of one query per level.
   */
  loadAncestorsOf?(ids: string[]): Promise<T[]>;
}

const idOf = (value: { toString(): string }) => value.toString();

function corrupt(message: string): PageError {
  return new PageError(message, PAGE_ERROR_CODES.INVALID_HIERARCHY, 500);
}

/**
 * Loads every ancestor of the given nodes level by level (one query per
 * level, however many nodes are requested). Returns id -> node for all
 * ancestors plus the starting nodes.
 */
export async function loadAncestorMap<T extends TreeNodeRef>(
  nodes: T[],
  loader: NodeLoader<T>,
): Promise<Map<string, T>> {
  const known = new Map<string, T>(nodes.map((node) => [idOf(node._id), node]));

  if (loader.loadAncestorsOf && nodes.some((node) => node.parent)) {
    for (const ancestor of await loader.loadAncestorsOf(nodes.map((node) => idOf(node._id)))) {
      known.set(idOf(ancestor._id), ancestor);
    }

    for (const node of known.values()) {
      if (node.parent && !known.has(idOf(node.parent))) {
        throw corrupt(`Broken parent reference: ${idOf(node.parent)}`);
      }
    }

    return known;
  }

  let missing = new Set<string>();

  for (const node of nodes) {
    if (node.parent && !known.has(idOf(node.parent))) {
      missing.add(idOf(node.parent));
    }
  }

  while (missing.size > 0) {
    const loaded = await loader.loadMany([...missing]);

    for (const node of loaded) {
      known.set(idOf(node._id), node);
    }

    const next = new Set<string>();

    for (const node of loaded) {
      if (node.parent && !known.has(idOf(node.parent))) {
        next.add(idOf(node.parent));
      }
    }

    // A parent id that could not be loaded is a dangling reference.
    for (const id of missing) {
      if (!known.has(id)) {
        throw corrupt(`Broken parent reference: ${id}`);
      }
    }

    missing = next;
  }

  return known;
}

/** Ancestors from the root down to the direct parent (node itself excluded). */
export function ancestorsFromMap<T extends TreeNodeRef>(node: T, map: Map<string, T>): T[] {
  const chain: T[] = [];
  const seen = new Set<string>([idOf(node._id)]);

  let current = node.parent ? map.get(idOf(node.parent)) : undefined;

  while (current) {
    const id = idOf(current._id);

    if (seen.has(id)) {
      throw corrupt(`Cycle detected in hierarchy at ${id}`);
    }

    seen.add(id);
    chain.push(current);

    current = current.parent ? map.get(idOf(current.parent)) : undefined;
  }

  return chain.reverse();
}

export async function getAncestors<T extends TreeNodeRef>(
  node: T,
  loader: NodeLoader<T>,
): Promise<T[]> {
  const map = await loadAncestorMap([node], loader);

  return ancestorsFromMap(node, map);
}

/** Public path ("/a/b/c") of a node from its ancestor chain. */
export function buildPath(ancestors: TreeNodeRef[], node: TreeNodeRef): string {
  return joinPath([...ancestors, node].map((item) => item.slug));
}

/**
 * Paths for many nodes at once (search results, lists) with one query per
 * hierarchy level in total, not per node.
 */
export async function buildPaths<T extends TreeNodeRef>(
  nodes: T[],
  loader: NodeLoader<T>,
): Promise<Map<string, string>> {
  const map = await loadAncestorMap(nodes, loader);

  return new Map(
    nodes.map((node) => [idOf(node._id), buildPath(ancestorsFromMap(node, map), node)]),
  );
}

/** Every descendant id (excluding the node), breadth-first, no recursion. */
export async function collectDescendantIds(rootId: string, loader: NodeLoader): Promise<string[]> {
  const result: string[] = [];
  const seen = new Set<string>([rootId]);

  let frontier = [rootId];

  while (frontier.length > 0) {
    const children = await loader.childIdsOf(frontier);

    frontier = [];

    for (const id of children) {
      if (seen.has(id)) continue;

      seen.add(id);
      result.push(id);
      frontier.push(id);
    }
  }

  return result;
}

/**
 * A node may move under `newParentId` only if that parent is neither the
 * node itself nor anywhere inside the node's own subtree.
 */
export async function assertCanMove(
  nodeId: string,
  newParentId: string | null,
  loader: NodeLoader,
): Promise<void> {
  if (newParentId === null) return;

  if (newParentId === nodeId) {
    throw PageError.cycle();
  }

  const [parent] = await loader.loadMany([newParentId]);

  if (!parent) {
    throw PageError.parentNotFound(newParentId);
  }

  const ancestors = await getAncestors(parent, loader);

  if (ancestors.some((ancestor) => idOf(ancestor._id) === nodeId)) {
    throw PageError.cycle();
  }
}
