import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../utils/errors.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('error-handler');

/**
 * Terminal error handler. Express recognises it by the 4-arg signature.
 *
 * Known errors (AppError) are returned as structured JSON with their own
 * status code. Unknown errors are logged with the stack and returned as a
 * generic 500 — we never leak internal error messages to clients.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? undefined,
      },
    });
  }

  log.error({ err, path: req.path, method: req.method }, 'unhandled error');
  return res.status(500).json({
    error: { code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong. Please try again.' },
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: ErrorCode.NOT_FOUND, message: `Route ${req.method} ${req.path} not found` },
  });
}
