// Shared error hierarchy — services throw these; the action/route
// boundary maps them to a typed result (never leak raw errors to the client).

export class AppError extends Error {
  readonly status: number = 500;
  readonly code: string = "INTERNAL_ERROR";

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = "UNAUTHORIZED";

  constructor(message = "You must be signed in.") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "You do not have permission to do this.") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "NOT_FOUND";
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "CONFLICT";
}

// Single response envelope for every Server Action / route handler.
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: unknown): ActionResult<never> {
  if (error instanceof AppError) {
    return { ok: false, error: error.message, code: error.code };
  }
  console.error(error);
  return { ok: false, error: "Something went wrong.", code: "INTERNAL_ERROR" };
}
