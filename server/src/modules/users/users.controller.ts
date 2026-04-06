import type { Request, Response, NextFunction } from 'express';
import * as service from './users.service.js';
import { Unauthorized } from '../../utils/errors.js';
import type { ListUsersQueryInput } from './users.schemas.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.listUsers(
      authOrThrow(req),
      req.query as unknown as ListUsersQueryInput,
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await service.getUser(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await service.createUser(authOrThrow(req), req.body, meta(req));
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await service.updateUser(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await service.resetPassword(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
