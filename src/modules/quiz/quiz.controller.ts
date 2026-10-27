import type { Request, Response } from 'express';
import * as service from './quiz.service.js';
import {
  adminListSchema,
  attemptsListSchema,
  bulkDeleteSchema,
  createQuizSchema,
  idParamSchema,
  publicListSchema,
  slugParamSchema,
  statusSchema,
  submitSchema,
  updateQuizSchema,
} from './quiz.validation.js';

// Express 5 forwards rejected promises from async handlers to the error middleware.

export const listPublic = async (req: Request, res: Response) => {
  const result = await service.listPublicQuizzes(publicListSchema.parse(req.query));
  res.json({ success: true, data: result.quizzes, pagination: result.pagination });
};

export const getPublicBySlug = async (req: Request, res: Response) => {
  const { slug } = slugParamSchema.parse(req.params);
  res.json({ success: true, data: await service.getPublicQuizBySlug(slug) });
};

export const submit = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.submitQuiz(id, submitSchema.parse(req.body));
  res.status(201).json({ success: true, message: 'Test submitted successfully', data });
};

export const listAdmin = async (req: Request, res: Response) => {
  const result = await service.listAdminQuizzes(adminListSchema.parse(req.query));
  res.json({ success: true, data: result.quizzes, pagination: result.pagination, stats: result.stats });
};

export const getAdminById = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ success: true, data: await service.getAdminQuiz(id) });
};

export const create = async (req: Request, res: Response) => {
  const data = await service.createQuiz(createQuizSchema.parse(req.body));
  res.status(201).json({ success: true, message: 'Mock test created successfully', data });
};

export const update = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.updateQuiz(id, updateQuizSchema.parse(req.body));
  res.json({ success: true, message: 'Mock test updated successfully', data });
};

export const updateStatus = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const data = await service.updateQuizStatus(id, statusSchema.parse(req.body));
  res.json({ success: true, message: 'Mock test status updated', data });
};

export const remove = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await service.deleteQuiz(id);
  res.json({ success: true, message: 'Mock test deleted successfully' });
};

export const bulkRemove = async (req: Request, res: Response) => {
  const { ids } = bulkDeleteSchema.parse(req.body);
  res.json({
    success: true,
    message: 'Mock tests deleted successfully',
    data: await service.bulkDeleteQuizzes(ids),
  });
};

export const attempts = async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { page, limit } = attemptsListSchema.parse(req.query);
  const result = await service.listAttempts(id, page, limit);
  res.json({ success: true, data: result.attempts, pagination: result.pagination });
};
