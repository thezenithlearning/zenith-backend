// program.routes.ts
import { Router } from 'express';
import { ProgramController } from './program.controller.js';
import { upload } from '../../middleware/upload.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = Router();

const uploadFields = upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'bannerImage', maxCount: 1 },
  { name: 'instructorImage', maxCount: 1 },
]);

// Public read routes
router.get('/', ProgramController.getAllPrograms);
router.get('/slug/:slug', ProgramController.getProgramBySlug);
router.get('/:id', ProgramController.getProgramById);

// Admin-only write routes
router.post('/', protect, authorize('admin'), uploadFields, ProgramController.createProgram);
router.patch('/:id', protect, authorize('admin'), uploadFields, ProgramController.updateProgram);
router.delete('/:id', protect, authorize('admin'), ProgramController.deleteProgram);

export default router;
