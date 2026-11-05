/**
 * Typed application errors. Every API route maps these to an HTTP status and a
 * message that is safe to show a user, so an authorization failure never leaks
 * whether a record exists.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AuthRequiredError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(message, 401, 'auth_required');
  }
}

/**
 * Used for both "you may not see this" and "it does not exist". Returning 404
 * for an unauthorized read stops the API confirming that a record exists.
 */
export class NotFoundError extends AppError {
  constructor(message = 'That record does not exist, or you do not have access to it.') {
    super(message, 404, 'not_found');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 403, 'forbidden');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Some of the information provided is not valid.', details?: unknown) {
    super(message, 422, 'validation_failed', details);
  }
}

/** A state transition the record's lifecycle does not allow. */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'conflict', details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Message shown when survey results are withheld to protect anonymity. */
export const SUPPRESSION_MESSAGE =
  'Results are hidden because too few people have responded. This protects respondent anonymity.';
