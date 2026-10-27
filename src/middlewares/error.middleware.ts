import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';
import { ZodError } from 'zod';
import { AssetError } from '../modules/asset/asset.error.js';
import { StorageError } from '../modules/storage/storage.error.js';
import { PageError } from '../modules/pages/page.error.js';

export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  if (isMulterError(err)) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      status: 'fail',
      code: 'BAD_REQUEST',
      message:
        err.code === 'LIMIT_FILE_SIZE'
          ? req.originalUrl.startsWith('/api/v1/files/uploads/')
            ? 'Upload parts must be 8 MB or smaller.'
            : req.originalUrl.startsWith('/api/v1/files')
              ? 'Files, including videos, must be 1 GB or smaller.'
              : 'The selected file exceeds the maximum upload size of 100 MB.'
          : err.message || 'Invalid file upload',
    });
    return;
  }

  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => {
        const field = issue.path.join('.');
        return field ? `${field}: ${issue.message}` : issue.message;
      })
      .join('; ');

    res.status(400).json({
      status: 'fail',
      code: 'VALIDATION_ERROR',
      message: message || 'Invalid request data',
      issues: err.issues,
    });
    return;
  }

  // ── Storage / asset library errors ────────────────────────────────────────
  if (err instanceof AssetError || err instanceof StorageError) {
    // Provider failures must not leak SDK details to clients.
    const safe = err.statusCode < 500;
    if (!safe) {
      logger.error({ err, req: sanitiseReq(req) }, 'Storage operation failed');
    }
    res.status(safe ? err.statusCode : 503).json({
      status: safe ? 'fail' : 'error',
      code: safe ? err.code : 'STORAGE_UNAVAILABLE',
      message: safe ? err.message : 'File storage is unavailable. Please try again shortly.',
    });
    return;
  }

  // ── CMS page errors ───────────────────────────────────────────────────────
  if (err instanceof PageError) {
    res.status(err.statusCode).json({
      status: err.statusCode < 500 ? 'fail' : 'error',
      code: err.code,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  // ── Mongoose duplicate key ────────────────────────────────────────────────
  if (isMongooseDuplicateKeyError(err)) {
    res.status(409).json({
      status: 'fail',
      code: 'USER_EXISTS',
      message: 'A user with that email already exists',
    });
    return;
  }

  // ── Mongoose validation error ─────────────────────────────────────────────
  if (isMongooseValidationError(err)) {
    const messages = Object.values((err as any).errors)
      .map((e: any) => e.message)
      .join(', ');
    res.status(400).json({ status: 'fail', code: 'VALIDATION_ERROR', message: messages });
    return;
  }

  // ── Known operational errors ──────────────────────────────────────────────
  if (err instanceof AppError) {
    // Log 5xx operational errors as warnings (they're expected, but track them)
    if (err.statusCode >= 500) {
      logger.warn({ err, req: sanitiseReq(req) }, 'Operational server error');
    }
    res.status(err.statusCode).json({
      status: err.statusCode < 500 ? 'fail' : 'error',
      code: err.code,
      message: err.message,
    });
    return;
  }

  // ── Unknown errors — never leak internals ─────────────────────────────────
  logger.error({ err, req: sanitiseReq(req) }, 'Unhandled error');

  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    status: 'error',
    code: 'INTERNAL',
    message: 'Internal server error',
    ...(isDev &&
      err instanceof Error && {
        detail: err.message,
        stack: err.stack,
      }),
  });
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMongooseDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as any).code === 11000;
}

function isMongooseValidationError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as any).name === 'ValidationError';
}

function isMulterError(
  err: unknown,
): err is Error & { code?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'MulterError'
  );
}

/** Strip sensitive fields before logging the request. */
function sanitiseReq(req: Request) {
  return {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}
