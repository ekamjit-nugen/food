import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './auth.controller.js';
import {
  AcceptInviteSchema,
  ChangePasswordSchema,
  InviteStaffSchema,
  LoginSchema,
  SignupSchema,
} from './auth.schemas.js';

/**
 * Auth routes, mounted at /api/v1/auth.
 *
 * Rate limiting:
 *   - /login is the only truly brute-forceable endpoint here. We cap it
 *     to 10 attempts per 15 minutes per IP. This is in-memory, so it
 *     resets on process restart and does not coordinate across nodes.
 *     Good enough for v1 single-instance. When we horizontally scale,
 *     swap the store for a Redis-backed one.
 *   - We do not rate-limit /me or /change-password at the router level;
 *     those require a valid JWT already, so the blast radius is small.
 */
export const authRouter: Router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Key on IP alone (not email) to prevent an attacker from locking out a
  // legitimate user by spamming their email from a different IP.
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' } },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  // 5/hour in prod — signup is cheap to abuse, each successful call creates
  // a tenant + user row, and legitimate operators sign up once. In test we
  // raise the ceiling so fixtures that provision multiple tenants per run
  // don't trip the limiter; the limiter logic itself is still covered in
  // the prod path.
  limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many signup attempts. Please try again later.' } },
});

authRouter.post('/signup', signupLimiter, validate(SignupSchema), ctrl.signup);

authRouter.post('/login', loginLimiter, validate(LoginSchema), ctrl.login);

authRouter.post(
  '/invite',
  requireAuth,
  validate(InviteStaffSchema),
  ctrl.inviteStaff,
);

// Public endpoint — token possession is the authorization. Rate-limited so
// an attacker can't brute-force a 32-byte base64url token via guessing.
const acceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many invite attempts. Please try again later.' } },
});
authRouter.post(
  '/accept-invite',
  acceptLimiter,
  validate(AcceptInviteSchema),
  ctrl.acceptInvite,
);

authRouter.get('/me', requireAuth, ctrl.me);

// Refresh token endpoint — no JWT required, the refresh token IS the auth.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many refresh attempts, try again later' } },
});
authRouter.post('/refresh', refreshLimiter, ctrl.refresh);

// Logout — revoke refresh token server-side
authRouter.post('/logout', requireAuth, ctrl.logout);

// Rate-limit change-password: a compromised JWT could brute-force the
// current password field. 5 attempts per 15 minutes per IP is generous
// for legitimate use and makes brute-force impractical.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many password change attempts. Please try again later.' } },
});
authRouter.post(
  '/change-password',
  requireAuth,
  changePasswordLimiter,
  validate(ChangePasswordSchema),
  ctrl.changePassword,
);
