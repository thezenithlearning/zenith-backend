import { Router } from 'express';
import { authorize, protect } from '../../middlewares/auth.middleware.js';
import * as c from './advertisement.controller.js';

const router = Router();

// Public – the active banners shown on the website
router.get('/public', c.getPublic);

// Admin
router.get('/', protect, authorize('admin'), c.getAll);
router.put('/:type', protect, authorize('admin'), c.save);

export default router;
