import { z } from 'zod';
import { AD_TYPES } from './advertisement.model.js';

export const typeParamSchema = z.object({ type: z.enum(AD_TYPES) });

// A destination is either a site path ("/course") or an absolute http(s) URL.
const linkUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === '' || /^\/(?!\/)/.test(v) || /^https?:\/\//i.test(v), {
    message: 'Link must start with / or http(s)://',
  });

export const saveAdvertisementSchema = z.object({
  title: z.string().trim().max(150).default(''),
  description: z.string().trim().max(500).default(''),
  imageUrl: z.string().trim().min(1, 'Upload an image for the banner').max(2000),
  mobileImageUrl: z.string().trim().max(2000).default(''),
  linkUrl: linkUrl.default(''),
  isActive: z.boolean().default(false),
  delaySeconds: z.coerce.number().int().min(0).max(600).default(5),
});

export type SaveAdvertisementInput = z.infer<typeof saveAdvertisementSchema>;
