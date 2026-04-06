import type { Request, Response, NextFunction } from 'express';
import { Unauthorized } from '../../utils/errors.js';
import * as svc from './settings.service.js';

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const settings = await svc.getSettings(req.auth);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateBusiness(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const settings = await svc.updateBusiness(req.auth, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateTax(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const settings = await svc.updateTax(req.auth, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateBilling(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const settings = await svc.updateBilling(req.auth, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateOperations(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const settings = await svc.updateOperations(req.auth, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}
