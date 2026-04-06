import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './devices.controller.js';
import {
  ConsumePairingSchema,
  DeviceLoginSchema,
} from './devices.schemas.js';

/**
 * Device pairing routes.
 *
 * Mounted in two places:
 *   - /api/v1/auth     → anonymous pair + device-login (this file's
 *     `devicesAuthRouter`). These are the only endpoints the mobile app
 *     hits before it has a tenant JWT.
 *   - /api/v1/users    → admin-side pair-code issue + list + revoke
 *     (this file's `devicesAdminRouter`). Attached to the users prefix
 *     because every operation is scoped to a target user id.
 *
 * Rate limiting:
 *   - /auth/pair: both endpoints are brute-forceable (code + token guess),
 *     so we cap per-IP hard. In-memory limiter is fine for v1 single-node;
 *     swap for Redis-backed when we scale out.
 *   - Admin endpoints sit behind requireAuth so we do not rate-limit them
 *     at the router level.
 */

const IdParamSchema = z.object({ id: z.string().uuid() });
const DeviceIdParamSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
});

// --- anonymous: /api/v1/auth/pair + /api/v1/auth/device-login -------------

export const devicesAuthRouter: Router = Router();

const pairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 20/15min per IP. A real staff member pairs once; this ceiling only
  // trips on guessing. In test we lift the cap so the suite can run many
  // pair roundtrips from the same loopback address.
  limit: process.env.NODE_ENV === 'test' ? 10000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'too many pair attempts, try again later' } },
});

const deviceLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Device login runs on every mobile cold start. A single phone in a
  // busy restaurant might legitimately hit this several times per shift;
  // the point of the limit is to stop token-guessing attacks, not to
  // throttle real devices. 60/15min per IP gives plenty of headroom.
  limit: process.env.NODE_ENV === 'test' ? 10000 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'too many device login attempts, try again later' } },
});

devicesAuthRouter.post(
  '/pair',
  pairLimiter,
  validate(ConsumePairingSchema),
  ctrl.consumePairing,
);

devicesAuthRouter.post(
  '/device-login',
  deviceLoginLimiter,
  validate(DeviceLoginSchema),
  ctrl.deviceLogin,
);

// --- admin: /api/v1/users/:id/pairing-codes + /:id/devices ----------------

export const devicesAdminRouter: Router = Router();

devicesAdminRouter.use(requireAuth);

devicesAdminRouter.post(
  '/:id/pairing-codes',
  validate(IdParamSchema, 'params'),
  ctrl.createPairingCode,
);

devicesAdminRouter.get(
  '/:id/devices',
  validate(IdParamSchema, 'params'),
  ctrl.listDevices,
);

devicesAdminRouter.delete(
  '/:id/devices/:deviceId',
  validate(DeviceIdParamSchema, 'params'),
  ctrl.revokeDevice,
);
