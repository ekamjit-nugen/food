/**
 * Canonical application error.
 *
 * All errors thrown from services/controllers that map to an HTTP response
 * should extend or use this class. Unknown errors are caught by the error
 * middleware and translated to 500.
 *
 * Error response shape (always):
 *   { error: { code: "UPPER_SNAKE_CASE", message: "Human-readable.", details?: {} } }
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(params: { statusCode: number; code: string; message: string; details?: unknown }) {
    super(params.message);
    this.name = 'AppError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details;
    Error.captureStackTrace?.(this, AppError);
  }
}

// ── Error code registry ────────────────────────────────────────────────
// Every known error code lives here so frontend and backend share a
// single source of truth. Codes are UPPER_SNAKE_CASE strings.

export const ErrorCode = {
  // 400
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_PRICE: 'INVALID_PRICE',
  MISSING_REASON: 'MISSING_REASON',
  // 401
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  // 403
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  // 404
  NOT_FOUND: 'NOT_FOUND',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  // 409
  SLUG_ALREADY_TAKEN: 'SLUG_ALREADY_TAKEN',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  DUPLICATE_CATEGORY: 'DUPLICATE_CATEGORY',
  TABLE_CODE_EXISTS: 'TABLE_CODE_EXISTS',
  ORDER_NOT_OPEN: 'ORDER_NOT_OPEN',
  BILL_EXISTS: 'BILL_EXISTS',
  DRAFT_ITEMS_EXIST: 'DRAFT_ITEMS_EXIST',
  TABLE_HAS_ORDER: 'TABLE_HAS_ORDER',
  INVALID_KOT_TRANSITION: 'INVALID_KOT_TRANSITION',
  CONFLICT: 'CONFLICT',
  // 410
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  // 429
  RATE_LIMITED: 'RATE_LIMITED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  // 500
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Convenience factories ──────────────────────────────────────────────

export const NotFound = (resource: string, id?: string | number) =>
  new AppError({
    statusCode: 404,
    code: ErrorCode.NOT_FOUND,
    message: `${resource}${id !== undefined ? ` "${id}"` : ''} not found`,
  });

export const BadRequest = (message: string, details?: unknown) =>
  new AppError({ statusCode: 400, code: ErrorCode.BAD_REQUEST, message, details });

export const ValidationError = (message: string, details?: unknown) =>
  new AppError({ statusCode: 400, code: ErrorCode.VALIDATION_ERROR, message, details });

export const Conflict = (message: string, details?: unknown) =>
  new AppError({ statusCode: 409, code: ErrorCode.CONFLICT, message, details });

export const Unauthorized = (message = 'Unauthorized') =>
  new AppError({ statusCode: 401, code: ErrorCode.UNAUTHORIZED, message });

export const Forbidden = (message = 'Forbidden') =>
  new AppError({ statusCode: 403, code: ErrorCode.FORBIDDEN, message });
