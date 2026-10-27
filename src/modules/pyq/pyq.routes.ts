import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { authorize, protect } from '../../middlewares/auth.middleware.js';
import { AppError } from '../../errors/AppError.js';
import * as c from './pyq.controller.js';

const router = Router();
const admin = [protect, authorize('admin')];

// PDF-only, in-memory intake (validated again by magic bytes in the service).
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) {
      cb(new AppError('Only PDF files are allowed for PYQs', 400, 'BAD_REQUEST'));
      return;
    }
    cb(null, true);
  },
}).single('pdf');

// Access requests create leads – throttle to blunt scripted spam.
const accessLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      status: 'fail',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again in a few minutes.',
    });
  },
});

// Public
router.get('/', c.listPublic);
router.get('/slug/:slug', c.getPublicBySlug);
router.post('/:id/access', accessLimiter, c.access);

// Admin
router.get('/admin', ...admin, c.listAdmin);
router.get('/admin/:id', ...admin, c.getAdminById);
router.post('/', ...admin, pdfUpload, c.create);
router.post('/bulk-delete', ...admin, c.bulkRemove);
router.put('/:id', ...admin, pdfUpload, c.update);
router.patch('/:id', ...admin, pdfUpload, c.update);
router.patch('/:id/status', ...admin, c.updateStatus);
router.delete('/:id', ...admin, c.remove);

export default router;
