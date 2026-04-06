import type { Request, Response, NextFunction } from 'express';
import * as service from './tables.service.js';
import { Unauthorized } from '../../utils/errors.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

export async function createTable(req: Request, res: Response, next: NextFunction) {
  try {
    const t = await service.createTable(authOrThrow(req), req.body, meta(req));
    res.status(201).json(t);
  } catch (err) {
    next(err);
  }
}

export async function bulkCreateTables(req: Request, res: Response, next: NextFunction) {
  try {
    const ts = await service.bulkCreateTables(authOrThrow(req), req.body, meta(req));
    res.status(201).json({ data: ts });
  } catch (err) {
    next(err);
  }
}

export async function listTables(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { includeInactive?: string; section?: string };
    const ts = await service.listTables(authOrThrow(req), {
      includeInactive: q.includeInactive === 'true',
      section: q.section,
    });
    res.json({ data: ts });
  } catch (err) {
    next(err);
  }
}

export async function getTable(req: Request, res: Response, next: NextFunction) {
  try {
    const t = await service.getTable(authOrThrow(req), (req.params as { id: string }).id);
    res.json(t);
  } catch (err) {
    next(err);
  }
}

export async function updateTable(req: Request, res: Response, next: NextFunction) {
  try {
    const t = await service.updateTable(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(t);
  } catch (err) {
    next(err);
  }
}

export async function deactivateTable(req: Request, res: Response, next: NextFunction) {
  try {
    const t = await service.deactivateTable(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.json(t);
  } catch (err) {
    next(err);
  }
}
