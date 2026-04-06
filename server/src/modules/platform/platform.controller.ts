import type { Request, Response, NextFunction } from 'express';
import { NotFound, Unauthorized } from '../../utils/errors.js';
import * as service from './platform.service.js';
import type { UpdateTenantStatusInput } from './platform.service.js';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.login(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.platformAuth) throw Unauthorized();
    res.json(req.platformAuth);
  } catch (err) {
    next(err);
  }
}

export async function listTenants(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listTenants();
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

export async function getStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await service.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function getTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const id = (req.params as { id: string }).id;
    const row = await service.getTenant(id);
    if (!row) throw NotFound('tenant not found');
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function patchTenantStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = (req.params as { id: string }).id;
    const body = req.body as UpdateTenantStatusInput;
    const row = await service.updateTenantStatus(id, body.status);
    if (!row) throw NotFound('tenant not found');
    res.json(row);
  } catch (err) {
    next(err);
  }
}
