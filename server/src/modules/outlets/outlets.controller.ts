import type { Request, Response, NextFunction } from 'express';
import { Unauthorized } from '../../utils/errors.js';
import * as svc from './outlets.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const outlets = await svc.listOutlets(req.auth);
    res.json({ data: outlets });
  } catch (err) { next(err); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const outlet = await svc.getOutlet(req.auth, (req.params as { id: string }).id);
    res.json(outlet);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const outlet = await svc.createOutlet(req.auth, req.body);
    res.status(201).json(outlet);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const outlet = await svc.updateOutlet(req.auth, (req.params as { id: string }).id, req.body);
    res.json(outlet);
  } catch (err) { next(err); }
}
