import { PAGE_ERROR_CODES } from './page.constants.js';

export class PageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly details?: unknown,
  ) {
    super(message);

    this.name = 'PageError';

    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(id: string): PageError {
    return new PageError(`Page not found: ${id}`, PAGE_ERROR_CODES.NOT_FOUND, 404);
  }

  static pathNotFound(path: string): PageError {
    return new PageError(`No public page at "${path}"`, PAGE_ERROR_CODES.PATH_NOT_FOUND, 404);
  }

  static parentNotFound(id: string): PageError {
    return new PageError(`Parent not found: ${id}`, PAGE_ERROR_CODES.PARENT_NOT_FOUND, 400);
  }

  static slugConflict(slug: string): PageError {
    return new PageError(
      `Another page in this location already uses the slug "${slug}"`,
      PAGE_ERROR_CODES.SLUG_CONFLICT,
      409,
    );
  }

  static slugReserved(slug: string): PageError {
    return new PageError(
      `"${slug}" is reserved by the application and cannot be used as a top-level slug`,
      PAGE_ERROR_CODES.SLUG_RESERVED,
      400,
    );
  }

  static slugInvalid(message: string): PageError {
    return new PageError(message, PAGE_ERROR_CODES.SLUG_INVALID, 400);
  }

  static cycle(): PageError {
    return new PageError(
      'A page cannot be moved into itself or one of its own descendants',
      PAGE_ERROR_CODES.CYCLE_DETECTED,
      400,
    );
  }

  static hasChildren(count: number): PageError {
    return new PageError(
      `This page has ${count} direct ${count === 1 ? 'child' : 'children'}. Confirm deleting the whole branch to continue.`,
      PAGE_ERROR_CODES.NODE_HAS_CHILDREN,
      409,
      { directChildren: count },
    );
  }

  static invalidReorder(message: string): PageError {
    return new PageError(message, PAGE_ERROR_CODES.INVALID_REORDER, 400);
  }
}
