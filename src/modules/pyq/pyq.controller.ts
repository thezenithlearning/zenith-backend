import type { Request, Response } from 'express';
import * as service from './pyq.service.js';
import {
  accessSchema,
  adminListSchema,
  bulkDeleteSchema,
  createPyqSchema,
  idParamSchema,
  publicListSchema,
  slugParamSchema,
  statusSchema,
  updatePyqSchema,
} from './pyq.validation.js';

// Express 5 forwards rejected promises from async handlers to the error middleware.

export const listPublic = async (req: Request, res: Response) => {
  const result = await service.listPublicPyqs(publicListSchema.parse(req.query));
  res.json({ success: true, data: result.pyqs, pagination: result.pagination });
};

export const getPublicBySlug = async (req: Request, res: Response) => {
  const { slug } = slugParamSchema.parse(req.params);
  res.json({ success: true, data: await service.getPublicPyqBySlug(slug) });
};

export const access = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.requestAccess(id, accessSchema.parse(req.body));
  res.status(201).json({ success: true, message: 'Access granted', data });
};

export const listAdmin = async (req: Request, res: Response) => {
  const result = await service.listAdminPyqs(adminListSchema.parse(req.query));
  res.json({ success: true, data: result.pyqs, pagination: result.pagination, stats: result.stats });
};

export const getAdminById = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ success: true, data: await service.getAdminPyq(id) });
};

export const create = async (req: Request, res: Response) => {
  const data = await service.createPyq(createPyqSchema.parse(req.body), req.file);
  res.status(201).json({ success: true, message: 'PYQ created successfully', data });
};

export const update = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.updatePyq(id, updatePyqSchema.parse(req.body), req.file);
  res.json({ success: true, message: 'PYQ updated successfully', data });
};

export const updateStatus = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.updatePyqStatus(id, statusSchema.parse(req.body));
  res.json({ success: true, message: 'PYQ status updated', data });
};

export const remove = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await service.deletePyq(id);
  res.json({ success: true, message: 'PYQ deleted successfully' });
};

export const bulkRemove = async (req: Request, res: Response) => {
  const { ids } = bulkDeleteSchema.parse(req.body);
  res.json({
    success: true,
    message: 'PYQs deleted successfully',
    data: await service.bulkDeletePyqs(ids),
  });
};
