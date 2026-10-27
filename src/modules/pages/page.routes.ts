import { Router } from 'express';

import { authorize, protect } from '../../middlewares/auth.middleware.js';

import {
  bulkNodes,
  createNode,
  deleteNode,
  duplicateNode,
  getNode,
  getNodeImpact,
  getSummary,
  listNodes,
  moveNode,
  previewNode,
  publicSitemap,
  reorderNodes,
  resolvePublicPath,
  updateNode,
} from './page.controller.js';

const router = Router();

// Public (read-only, published content only)
router.get('/public/resolve', resolvePublicPath);
router.get('/public/sitemap', publicSitemap);

// Dashboard (authenticated). Static paths must be registered before "/:id".
router.use(protect, authorize('admin'));
router.get('/summary', getSummary);
router.put('/reorder', reorderNodes);
router.post('/bulk', bulkNodes);

router.get('/', listNodes);
router.post('/', createNode);

router.get('/:id', getNode);
router.get('/:id/impact', getNodeImpact);
router.get('/:id/preview', previewNode);
router.patch('/:id', updateNode);
router.patch('/:id/move', moveNode);
router.post('/:id/duplicate', duplicateNode);
router.delete('/:id', deleteNode);

export default router;
