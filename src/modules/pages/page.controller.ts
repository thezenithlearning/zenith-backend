import type { Request, Response } from 'express';

import { pagePublicService } from './page.public.service.js';
import { pageService } from './page.service.js';
import {
  bulkSchema,
  createNodeSchema,
  deleteQuerySchema,
  listNodesQuerySchema,
  moveNodeSchema,
  nodeIdParamSchema,
  publicPathQuerySchema,
  reorderSchema,
  updateNodeSchema,
} from './page.validation.js';

// Express 5 forwards rejected promises to the error middleware,
// so handlers don't need try/catch.

export async function listNodes(req: Request, res: Response) {
  const query = listNodesQuerySchema.parse(req.query);
  const { items, pagination } = await pageService.list(query);

  return res.status(200).json({ success: true, data: items, pagination });
}

export async function getSummary(_req: Request, res: Response) {
  return res.status(200).json({ success: true, data: await pageService.summary() });
}

export async function getNode(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);

  return res.status(200).json({ success: true, data: await pageService.getById(id) });
}

export async function getNodeImpact(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);

  return res.status(200).json({ success: true, data: await pageService.getImpact(id) });
}

export async function previewNode(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);

  return res.status(200).json({ success: true, data: await pagePublicService.preview(id) });
}

export async function createNode(req: Request, res: Response) {
  const input = createNodeSchema.parse(req.body);

  return res.status(201).json({
    success: true,
    message: 'Page created successfully',
    data: await pageService.create(input),
  });
}

export async function updateNode(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);
  const input = updateNodeSchema.parse(req.body);

  return res.status(200).json({
    success: true,
    message: 'Page updated successfully',
    data: await pageService.update(id, input),
  });
}

export async function moveNode(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);
  const input = moveNodeSchema.parse(req.body);

  return res.status(200).json({
    success: true,
    message: 'Page moved successfully',
    data: await pageService.move(id, input),
  });
}

export async function reorderNodes(req: Request, res: Response) {
  const input = reorderSchema.parse(req.body);

  await pageService.reorder(input);

  return res.status(200).json({ success: true, message: 'Order saved' });
}

export async function duplicateNode(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);

  return res.status(201).json({
    success: true,
    message: 'Page duplicated as a draft',
    data: await pageService.duplicate(id),
  });
}

export async function deleteNode(req: Request, res: Response) {
  const { id } = nodeIdParamSchema.parse(req.params);
  const { cascade } = deleteQuerySchema.parse(req.query);

  return res.status(200).json({
    success: true,
    message: 'Page deleted successfully',
    data: await pageService.delete(id, cascade),
  });
}

export async function bulkNodes(req: Request, res: Response) {
  const { action, ids, cascade } = bulkSchema.parse(req.body);

  return res.status(200).json({
    success: true,
    data: await pageService.bulk(action, ids, cascade),
  });
}

export async function resolvePublicPath(req: Request, res: Response) {
  const { path } = publicPathQuerySchema.parse(req.query);

  return res.status(200).json({
    success: true,
    data: await pagePublicService.resolve(path),
  });
}

export async function publicSitemap(_req: Request, res: Response) {
  return res.status(200).json({
    success: true,
    data: await pagePublicService.sitemap(),
  });
}
