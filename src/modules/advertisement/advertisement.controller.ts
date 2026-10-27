import type { Request, Response } from 'express';
import type { AuthRequest } from '../../middlewares/auth.middleware.js';
import { Advertisement } from './advertisement.model.js';
import { saveAdvertisementSchema, typeParamSchema } from './advertisement.validation.js';

// Express 5 forwards rejected promises from async handlers to the error middleware.

const PUBLIC_FIELDS = 'type title description imageUrl mobileImageUrl linkUrl delaySeconds updatedAt';

/** Public: only the banners the admin has switched on. */
export const getPublic = async (_req: Request, res: Response) => {
  const ads = await Advertisement.find({ isActive: true }).select(PUBLIC_FIELDS).lean();
  res.json({
    success: true,
    data: {
      popup: ads.find((a) => a.type === 'popup') ?? null,
      topbar: ads.find((a) => a.type === 'topbar') ?? null,
    },
  });
};

/** Admin: both banners, active or not. */
export const getAll = async (_req: Request, res: Response) => {
  const ads = await Advertisement.find().lean();
  res.json({
    success: true,
    data: {
      popup: ads.find((a) => a.type === 'popup') ?? null,
      topbar: ads.find((a) => a.type === 'topbar') ?? null,
    },
  });
};

/** Admin: create or replace the banner of one type. */
export const save = async (req: AuthRequest, res: Response) => {
  const { type } = typeParamSchema.parse(req.params);
  const input = saveAdvertisementSchema.parse(req.body);
  const ad = await Advertisement.findOneAndUpdate(
    { type },
    { $set: { ...input, updatedBy: req.user?.userId } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  res.json({ success: true, message: 'Advertisement saved', data: ad });
};
