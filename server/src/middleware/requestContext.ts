import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Attach a stable request id to every request. Used in audit rows and log
 * lines so we can correlate an API call to its DB effects.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9_.:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}
