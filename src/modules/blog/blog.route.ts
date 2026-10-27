import { Router } from 'express';
import { blogUpload } from '../../middleware/upload.js';

import blogController from './blog.controller.js';
import {
  authorize,
  protect,
} from '../../middlewares/auth.middleware.js';

const router = Router();

const blogFiles = blogUpload.fields([
  {
    name: 'banner',
    maxCount: 1,
  },
  {
    name: 'resources',
    maxCount: 10,
  },
]);

// Public routes
router.get('/', blogController.getBlogs);
router.get('/stats', blogController.getBlogStats);
router.get('/sitemap-data', blogController.getBlogSitemapData);
router.get(
  '/slug/:slug',
  blogController.getBlogBySlug,
);
router.get('/:id', blogController.getBlogById);

// Admin routes
router.post(
  '/',
  protect,
  authorize('admin'),
  blogFiles,
  blogController.createBlog,
);

router.put(
  '/:id',
  protect,
  authorize('admin'),
  blogFiles,
  blogController.updateBlog,
);

// PATCH is also supported so the client can use partial updates.
router.patch(
  '/:id',
  protect,
  authorize('admin'),
  blogFiles,
  blogController.updateBlog,
);

router.delete(
  '/:id',
  protect,
  authorize('admin'),
  blogController.deleteBlog,
);

router.post(
  '/bulk-delete',
  protect,
  authorize('admin'),
  blogController.deleteMultipleBlogs,
);

router.patch(
  '/:id/status',
  protect,
  authorize('admin'),
  blogController.updateBlogStatus,
);

export default router;
