// zenith-backend\src\modules\course\course.route.ts
import { Router } from 'express';
import { courseUpload } from '../../middleware/upload.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';
import {
  createCourse,
  getAllCourses,
  getCourseBySlug,
  getCourseById,
  updateCourse,
  deleteCourse,
} from './course.controller.js';

const router = Router();

router.get('/', getAllCourses);
router.get('/slug/:slug', getCourseBySlug);
router.get('/:id', getCourseById);

router.post(
  '/',
  protect,
  authorize('admin'),
  courseUpload.fields([
    { name: 'bannerImage', maxCount: 1 },
    { name: 'resources', maxCount: 19 },
  ]),
  createCourse,
);

router.patch(
  '/:id',
  protect,
  authorize('admin'),
  courseUpload.fields([
    { name: 'bannerImage', maxCount: 1 },
    { name: 'resources', maxCount: 19 },
  ]),
  updateCourse,
);

router.delete('/:id', protect, authorize('admin'), deleteCourse);

export default router;
