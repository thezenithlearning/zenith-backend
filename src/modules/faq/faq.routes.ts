import { Router } from 'express';
import { authorize, protect } from '../../middlewares/auth.middleware.js';
import * as c from './faq.controller.js';

const router = Router();
const admin = [protect, authorize('admin')];

// Public – only live (published / due-scheduled) FAQs
router.get('/', c.listPublic);

// Admin
router.get('/admin', ...admin, c.listAdmin);
router.get('/admin/:id', ...admin, c.getById);
router.post('/', ...admin, c.create);
router.post('/bulk-delete', ...admin, c.bulkRemove);
router.put('/:id', ...admin, c.update);
router.patch('/:id', ...admin, c.update);
router.patch('/:id/status', ...admin, c.updateStatus);
router.delete('/:id', ...admin, c.remove);

export default router;
