import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requirePlatformAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './platform.controller.js';
import {
  PlatformLoginSchema,
  TenantIdParamSchema,
  UpdateTenantStatusSchema,
} from './platform.service.js';

/**
 * Platform super-admin routes, mounted at /api/v1/platform.
 *
 * This namespace is for the people who run the SaaS itself — not for
 * tenant operators. Nothing here talks to tenant-scoped data via the
 * request's auth context; any tenant CRUD will resolve tenantId from
 * the path (e.g. /platform/tenants/:id) and must always include the
 * explicit tenantId in repository calls.
 */
export const platformRouter: Router = Router();

const platformLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'too many platform login attempts, try again later' } },
});

platformRouter.post('/auth/login', platformLoginLimiter, validate(PlatformLoginSchema), ctrl.login);
platformRouter.get('/auth/me', requirePlatformAuth, ctrl.me);

// Tenant directory — read-only list + detail, plus status-only PATCH.
// Every tenant read resolves tenantId from the URL; repository calls carry
// the tenantId explicitly so the query scope is unambiguous at the call site.
platformRouter.get('/stats', requirePlatformAuth, ctrl.getStats);
platformRouter.get('/tenants', requirePlatformAuth, ctrl.listTenants);
platformRouter.get(
  '/tenants/:id',
  requirePlatformAuth,
  validate(TenantIdParamSchema, 'params'),
  ctrl.getTenant,
);
platformRouter.patch(
  '/tenants/:id/status',
  requirePlatformAuth,
  validate(TenantIdParamSchema, 'params'),
  validate(UpdateTenantStatusSchema),
  ctrl.patchTenantStatus,
);
