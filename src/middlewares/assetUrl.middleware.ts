import { Request, Response, NextFunction } from 'express';
import { injectAssetUrls } from '../utils/asset.js';

/**
 * Response middleware that rewrites every JSON payload so each stored asset
 * (any object carrying a `storageKey`, `publicId` or library `key`) is
 * returned with a fully-resolved CDN `url`.
 *
 * Centralising this here means controllers/services just persist and return
 * the stored object key — the public URL is computed in one place from
 * CDN_BASE_URL, so moving to another domain or CDN is a config change, not a
 * data migration.
 */
export const assetUrlMiddleware = (_req: Request, res: Response, next: NextFunction): void => {
  const originalJson = res.json.bind(res);

  res.json = (body: unknown) => originalJson(injectAssetUrls(body));
  next();
};
