import { ASSET_ERROR_CODES } from './asset.constants.js';

export class AssetError extends Error {
  public readonly code: string;

  public readonly statusCode: number;

  public readonly details?: unknown;

  constructor(message: string, code: string = 'ASSET_ERROR', statusCode = 500, details?: unknown) {
    super(message);

    this.name = 'AssetError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }

  static fileRequired(): AssetError {
    return new AssetError('File is required', ASSET_ERROR_CODES.FILE_REQUIRED, 400);
  }

  static altRequired(): AssetError {
    return new AssetError('Alt text is required for images', ASSET_ERROR_CODES.ALT_REQUIRED, 400);
  }

  static notFound(identifier: string): AssetError {
    return new AssetError(`Asset not found: ${identifier}`, ASSET_ERROR_CODES.NOT_FOUND, 404);
  }

  static slugConflict(slug: string): AssetError {
    return new AssetError(
      `An asset with slug "${slug}" already exists`,
      ASSET_ERROR_CODES.SLUG_CONFLICT,
      409,
    );
  }

  static typeMismatch(expected: string, received: string): AssetError {
    return new AssetError(
      `Replacement file must be of type "${expected}", received "${received}"`,
      ASSET_ERROR_CODES.TYPE_MISMATCH,
      400,
    );
  }
}
