import type { Request, Response, NextFunction } from 'express';
import * as service from './auth.service.js';
import { BadRequest, Unauthorized } from '../../utils/errors.js';
import { pool } from '../../db/index.js';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.login(req.body, { ipAddress: req.ip });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.signup(req.body, { ipAddress: req.ip });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function inviteStaff(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const result = await service.inviteStaff(req.auth, req.body, {
      requestId: req.requestId,
      ipAddress: req.ip,
    });
    // In dev we return the raw token so local testing is possible without
    // an email worker. In production the token should ONLY reach the
    // invitee via email — strip it from the response when NODE_ENV=production.
    if (process.env.NODE_ENV === 'production') {
      res.status(201).json({ expiresAt: result.expiresAt });
    } else {
      res.status(201).json(result);
    }
  } catch (err) {
    next(err);
  }
}

export async function acceptInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.acceptInvite(req.body, { ipAddress: req.ip });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    const user = await service.getMe(req.auth);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    await service.changePassword(req.auth, req.body, {
      requestId: req.requestId,
      ipAddress: req.ip,
    });
    // Revoke all refresh tokens on password change so other sessions are killed
    await service.revokeAllRefreshTokens(pool, req.auth.userId, 'password_changed');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw BadRequest('refreshToken is required');
    }
    const result = await service.refreshSession(refreshToken);
    res.json({
      token: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw Unauthorized();
    await service.revokeAllRefreshTokens(pool, req.auth.userId, 'logout');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
