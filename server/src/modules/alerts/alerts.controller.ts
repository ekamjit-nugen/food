import type { Request, Response, NextFunction } from 'express';
import { Unauthorized } from '../../utils/errors.js';
import * as service from './alerts.service.js';
import type { ListAlertsQueryInput } from './alerts.schemas.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

export async function createAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const alert = await service.createAlert(authOrThrow(req), req.body, meta(req));
    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
}

export async function ackAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const alert = await service.ackAlert(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.json(alert);
  } catch (err) {
    next(err);
  }
}

export async function listAlerts(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as unknown as ListAlertsQueryInput;
    const data = await service.listAlerts(authOrThrow(req), { activeOnly: q.active });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
