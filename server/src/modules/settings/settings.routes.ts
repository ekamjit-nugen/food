import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  UpdateBusinessSchema,
  UpdateTaxSchema,
  UpdateBillingSchema,
  UpdateOperationsSchema,
} from './settings.schemas.js';
import * as ctrl from './settings.controller.js';

export const settingsRouter = Router();

// GET — any authenticated admin/manager can view
settingsRouter.get('/', requireAuth, requireRole('admin', 'manager'), ctrl.get);

// PATCH sections — admin only
settingsRouter.patch(
  '/business',
  requireAuth,
  requireRole('admin'),
  validate(UpdateBusinessSchema),
  ctrl.updateBusiness,
);

settingsRouter.patch(
  '/tax',
  requireAuth,
  requireRole('admin'),
  validate(UpdateTaxSchema),
  ctrl.updateTax,
);

settingsRouter.patch(
  '/billing',
  requireAuth,
  requireRole('admin'),
  validate(UpdateBillingSchema),
  ctrl.updateBilling,
);

settingsRouter.patch(
  '/operations',
  requireAuth,
  requireRole('admin'),
  validate(UpdateOperationsSchema),
  ctrl.updateOperations,
);
