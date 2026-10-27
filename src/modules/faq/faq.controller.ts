import type { Request, Response } from 'express';
import * as service from './faq.service.js';
import {
  adminListSchema,
  bulkDeleteSchema,
  createFaqSchema,
  idParamSchema,
  publicListSchema,
  statusSchema,
  updateFaqSchema,
} from './faq.validation.js';

// Express 5 forwards rejected promises from async handlers to the error middleware.

export const listPublic = async (req: Request, res: Response) => {
  const result = await service.listPublicFaqs(publicListSchema.parse(req.query));
  res.json({ success: true, data: result.faqs, pagination: result.pagination });
};

export const listAdmin = async (req: Request, res: Response) => {
  const result = await service.listAdminFaqs(adminListSchema.parse(req.query));
  res.json({ success: true, data: result.faqs, pagination: result.pagination, stats: result.stats });
};

export const getById = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ success: true, data: await service.getFaqById(id) });
};

export const create = async (req: Request, res: Response) => {
  const data = await service.createFaq(createFaqSchema.parse(req.body));
  res.status(201).json({ success: true, message: 'FAQ created successfully', data });
};

export const update = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.updateFaq(id, updateFaqSchema.parse(req.body));
  res.json({ success: true, message: 'FAQ updated successfully', data });
};

export const updateStatus = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.updateFaqStatus(id, statusSchema.parse(req.body));
  res.json({ success: true, message: 'FAQ status updated', data });
};

export const remove = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await service.deleteFaq(id);
  res.json({ success: true, message: 'FAQ deleted successfully' });
};

export const bulkRemove = async (req: Request, res: Response) => {
  const { ids } = bulkDeleteSchema.parse(req.body);
  res.json({
    success: true,
    message: 'FAQs deleted successfully',
    data: await service.bulkDeleteFaqs(ids),
  });
};
