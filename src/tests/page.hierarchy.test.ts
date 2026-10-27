import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertCanMove,
  buildPaths,
  collectDescendantIds,
  getAncestors,
  type NodeLoader,
  type TreeNodeRef,
} from '../modules/pages/page.hierarchy.js';
import { resolveSeo, buildRobots, breadcrumbLabel } from '../modules/pages/page.seo.js';
import { findFreeSlug, isValidSlug, slugifyTitle, splitPath } from '../modules/pages/page.utils.js';

interface TestNode extends TreeNodeRef {
  _id: string;
  parent: string | null;
}

function makeTree(edges: Array<[id: string, parent: string | null, slug?: string]>) {
  const nodes = new Map<string, TestNode>(
    edges.map(([id, parent, slug]) => [id, { _id: id, parent, slug: slug ?? id, title: id }]),
  );

  const loader: NodeLoader<TestNode> = {
    loadMany: async (ids) => ids.flatMap((id) => (nodes.has(id) ? [nodes.get(id)!] : [])),
    childIdsOf: async (parentIds) =>
      [...nodes.values()].filter((n) => n.parent && parentIds.includes(n.parent)).map((n) => n._id),
  };

  return { nodes, loader };
}

describe('hierarchy', () => {
  const { nodes, loader } = makeTree([
    ['a', null],
    ['a1', 'a'],
    ['a1i', 'a1'],
    ['b', null],
    ['b1', 'b'],
  ]);

  it('builds ancestors root-first', async () => {
    const ancestors = await getAncestors(nodes.get('a1i')!, loader);

    assert.deepEqual(
      ancestors.map((n) => n._id),
      ['a', 'a1'],
    );
  });

  it('builds public paths from the parent chain', async () => {
    const paths = await buildPaths([nodes.get('a1i')!, nodes.get('b1')!], loader);

    assert.equal(paths.get('a1i'), '/a/a1/a1i');
    assert.equal(paths.get('b1'), '/b/b1');
  });

  it('collects all descendants', async () => {
    assert.deepEqual((await collectDescendantIds('a', loader)).sort(), ['a1', 'a1i']);
  });

  it('rejects moving a node into itself', async () => {
    await assert.rejects(() => assertCanMove('a', 'a', loader), { code: 'CYCLE_DETECTED' });
  });

  it('rejects moving a node into its own descendant', async () => {
    await assert.rejects(() => assertCanMove('a', 'a1i', loader), { code: 'CYCLE_DETECTED' });
  });

  it('allows moving to root and to another branch', async () => {
    await assertCanMove('a1', null, loader);
    await assertCanMove('a1', 'b', loader);
  });

  it('detects a corrupted cycle instead of looping forever', async () => {
    const broken = makeTree([
      ['x', 'z'],
      ['y', 'x'],
      ['z', 'y'],
    ]);

    await assert.rejects(() => getAncestors(broken.nodes.get('x')!, broken.loader), {
      code: 'INVALID_HIERARCHY',
    });
  });

  it('reports a dangling parent reference', async () => {
    const dangling = makeTree([['x', 'missing']]);

    await assert.rejects(() => getAncestors(dangling.nodes.get('x')!, dangling.loader), {
      code: 'INVALID_HIERARCHY',
    });
  });

  it('handles a 500 level deep chain without recursion limits', async () => {
    const edges: Array<[string, string | null]> = [];

    for (let i = 0; i < 500; i++) edges.push([`n${i}`, i === 0 ? null : `n${i - 1}`]);

    const deep = makeTree(edges);
    const ancestors = await getAncestors(deep.nodes.get('n499')!, deep.loader);

    assert.equal(ancestors.length, 499);
    assert.equal((await collectDescendantIds('n0', deep.loader)).length, 499);
    await assert.rejects(() => assertCanMove('n0', 'n499', deep.loader), {
      code: 'CYCLE_DETECTED',
    });
  });
});

describe('slugs', () => {
  it('slugifies titles', () => {
    assert.equal(slugifyTitle('RBI Grade B (2026)!'), 'rbi-grade-b-2026');
    assert.equal(slugifyTitle('Café & Bar'), 'cafe-and-bar');
    assert.equal(slugifyTitle('!!!'), '');
  });

  it('validates slug characters (no slash, no spaces, no uppercase)', () => {
    assert.ok(isValidSlug('about-us'));
    assert.ok(!isValidSlug('about/us'));
    assert.ok(!isValidSlug('About'));
    assert.ok(!isValidSlug('a b'));
    assert.ok(!isValidSlug('--x'));
  });

  it('splits paths', () => {
    assert.deepEqual(splitPath('/a//b/'), ['a', 'b']);
  });

  it('finds a free copy slug', async () => {
    const taken = new Set(['about-copy', 'about-copy-2']);

    assert.equal(await findFreeSlug('about', async (s) => taken.has(s)), 'about-copy-3');
  });
});

describe('seo fallbacks', () => {
  const base = {
    title: 'RBI Grade B',
    heading: '',
    summary: 'Summary text',
    seo: {
      title: '',
      description: '',
      canonicalUrl: '',
      robotsIndex: true,
      robotsFollow: true,
      ogTitle: '',
      ogDescription: '',
      ogImage: '',
      twitterCard: 'summary_large_image' as const,
      keywords: [],
      breadcrumbTitle: '',
      sitemapInclude: true,
      sitemapPriority: null,
      sitemapChangeFrequency: null,
    },
    appearance: {
      layout: 'standard' as const,
      pageWidth: 'normal' as const,
      showHeading: true,
      showBreadcrumbs: true,
      coverImageUrl: '',
      coverImageAlt: '',
      childDisplay: 'none' as const,
      childrenTitle: '',
    },
  };

  it('falls back to title, summary and the generated canonical URL', () => {
    const seo = resolveSeo(base, [], '/exams/rbi', 'https://x.com');

    assert.equal(seo.title, 'RBI Grade B');
    assert.equal(seo.description, 'Summary text');
    assert.equal(seo.canonicalUrl, 'https://x.com/exams/rbi');
    assert.equal(seo.openGraph.title, 'RBI Grade B');
    assert.equal(seo.robots, 'index, follow');
  });

  it('prefers explicit values and inherits og image from the nearest ancestor', () => {
    const parent = { ...base, seo: { ...base.seo, ogImage: '/img/parent.png' } };
    const node = {
      ...base,
      seo: { ...base.seo, title: 'Custom', canonicalUrl: 'https://y.com/c' },
    };
    const seo = resolveSeo(node, [parent], '/p/c', 'https://x.com');

    assert.equal(seo.title, 'Custom');
    assert.equal(seo.canonicalUrl, 'https://y.com/c');
    assert.equal(seo.openGraph.image, 'https://x.com/img/parent.png');
  });

  it('builds robots and breadcrumb labels', () => {
    assert.equal(buildRobots({ robotsIndex: false, robotsFollow: false }), 'noindex, nofollow');
    assert.equal(
      breadcrumbLabel({ title: 'Long Title', seo: { ...base.seo, breadcrumbTitle: 'Short' } }),
      'Short',
    );
    assert.equal(breadcrumbLabel({ title: 'Long Title', seo: base.seo }), 'Long Title');
  });
});
