export class StorageError extends Error {
  public readonly code: string;

  public readonly statusCode: number;

  public readonly details?: unknown;

  constructor(message: string, code = 'STORAGE_ERROR', statusCode = 500, details?: unknown) {
    super(message);

    this.name = 'StorageError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}
