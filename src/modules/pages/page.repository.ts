import { Types, type QueryFilter } from 'mongoose';

import { PageNode } from './page.model.js';
import type { IPageNode, PageNodeDocument } from './page.type.js';

/**
 * All database access for page nodes. Services never build queries
 * themselves, so the hierarchy rules stay testable and the storage can
 * change without touching them.
 */

export type ParentRef = Types.ObjectId | string | null;

/** A node is publicly reachable only inside its publish window. */
export function publicFilter(now = new Date()): QueryFilter<IPageNode> {
  return {
    status: 'published',
    $and: [
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ unpublishAt: null }, { unpublishAt: { $gt: now } }] },
    ],
  };
}

export const pageRepository = {
  findById(id: string): Promise<PageNodeDocument | null> {
    return PageNode.findById(id).lean<PageNodeDocument>();
  },

  findManyByIds(ids: ParentRef[]): Promise<PageNodeDocument[]> {
    return PageNode.find({ _id: { $in: ids } }).lean<PageNodeDocument[]>();
  },

  findChild(
    parent: ParentRef,
    slug: string,
    extra: QueryFilter<IPageNode> = {},
  ): Promise<PageNodeDocument | null> {
    return PageNode.findOne({ parent, slug, ...extra }).lean<PageNodeDocument>();
  },

  find(
    filter: QueryFilter<IPageNode>,
    options: {
      sort?: Record<string, 1 | -1>;
      skip?: number;
      limit?: number;
    } = {},
  ): Promise<PageNodeDocument[]> {
    let query = PageNode.find(filter);

    if (options.sort) query = query.sort(options.sort);
    if (options.skip) query = query.skip(options.skip);
    if (options.limit) query = query.limit(options.limit);

    return query.lean<PageNodeDocument[]>();
  },

  count(filter: QueryFilter<IPageNode>): Promise<number> {
    return PageNode.countDocuments(filter);
  },

  exists(filter: QueryFilter<IPageNode>): Promise<boolean> {
    return PageNode.exists(filter).then(Boolean);
  },

  async create(data: Partial<IPageNode>): Promise<PageNodeDocument> {
    const created = await PageNode.create(data);

    return created.toObject() as PageNodeDocument;
  },

  update(
    id: string | Types.ObjectId,
    changes: Record<string, unknown>,
  ): Promise<PageNodeDocument | null> {
    return PageNode.findByIdAndUpdate(
      id,
      { $set: changes },
      { new: true, runValidators: true },
    ).lean<PageNodeDocument>();
  },

  updateMany(
    filter: QueryFilter<IPageNode>,
    changes: Record<string, unknown>,
  ): Promise<{ modifiedCount: number }> {
    return PageNode.updateMany(filter, { $set: changes });
  },

  deleteMany(ids: Array<string | Types.ObjectId>): Promise<{ deletedCount: number }> {
    return PageNode.deleteMany({ _id: { $in: ids } });
  },

  async maxOrder(parent: ParentRef): Promise<number> {
    const last = await PageNode.findOne({ parent })
      .sort({ order: -1 })
      .select('order')
      .lean<{ order: number }>();

    return last?.order ?? -1;
  },

  /** { parentId -> number of direct children } for the given parents. */
  async countChildrenByParent(
    parentIds: Array<string | Types.ObjectId>,
  ): Promise<Map<string, number>> {
    if (parentIds.length === 0) return new Map();

    const rows = await PageNode.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { parent: { $in: parentIds.map((id) => new Types.ObjectId(String(id))) } } },
      { $group: { _id: '$parent', count: { $sum: 1 } } },
    ]);

    return new Map(rows.map((row) => [String(row._id), row.count]));
  },

  /**
   * All ancestors of the given nodes in a single aggregation, however deep
   * the tree is. Bodies are excluded: callers only need routing/SEO fields.
   */
  findAncestorsOf(ids: string[]): Promise<PageNodeDocument[]> {
    return PageNode.aggregate<PageNodeDocument>([
      { $match: { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } } },
      {
        $graphLookup: {
          from: PageNode.collection.name,
          startWith: '$parent',
          connectFromField: 'parent',
          connectToField: '_id',
          as: 'ancestors',
        },
      },
      { $unwind: '$ancestors' },
      { $replaceRoot: { newRoot: '$ancestors' } },
      { $project: { html: 0 } },
      { $group: { _id: '$_id', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
    ]);
  },

  bulkSetOrder(updates: Array<{ id: string; order: number }>) {
    return PageNode.bulkWrite(
      updates.map(({ id, order }) => ({
        updateOne: { filter: { _id: id }, update: { $set: { order } } },
      })),
    );
  },
};
