import type { Request, Response, NextFunction } from 'express';
import { Unauthorized } from '../../utils/errors.js';
import * as service from './devices.service.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

// --- admin endpoints ------------------------------------------------------

export async function createPairingCode(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createPairingCode(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listDevices(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.listDevices(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function revokeDevice(req: Request, res: Response, next: NextFunction) {
  try {
    const device = await service.revokeDevice(
      authOrThrow(req),
      (req.params as { deviceId: string }).deviceId,
      meta(req),
    );
    res.json(device);
  } catch (err) {
    next(err);
  }
}

// --- mobile endpoints (anonymous) -----------------------------------------

export async function consumePairing(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.consumePairingCode(req.body, { ipAddress: req.ip });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function deviceLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.deviceLogin(req.body, { ipAddress: req.ip });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
