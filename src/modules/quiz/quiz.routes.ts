import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authorize, protect } from '../../middlewares/auth.middleware.js';
import * as c from './quiz.controller.js';

const router = Router();
const admin = [protect, authorize('admin')];

// Submissions create leads – throttle to blunt scripted spam.
const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      status: 'fail',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many submissions. Please try again in a few minutes.',
    });
  },
});

// Public
router.get('/', c.listPublic);
router.get('/slug/:slug', c.getPublicBySlug);
router.post('/:id/submit', submitLimiter, c.submit);

// Admin
router.get('/admin', ...admin, c.listAdmin);
router.get('/admin/:id', ...admin, c.getAdminById);
router.get('/admin/:id/attempts', ...admin, c.attempts);
router.post('/', ...admin, c.create);
router.post('/bulk-delete', ...admin, c.bulkRemove);
router.put('/:id', ...admin, c.update);
router.patch('/:id', ...admin, c.update);
router.patch('/:id/status', ...admin, c.updateStatus);
router.delete('/:id', ...admin, c.remove);

export default router;
