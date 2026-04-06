import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './reports.controller.js';
import { DateRangeSchema, OrderMasterQuerySchema } from './reports.schemas.js';

/**
 * Reports are read-only aggregates. Scoped to admin + manager: staff and
 * kitchen don't need the P&L surface, and revenue data should not leak
 * through shared POS terminals.
 */
export const reportsRouter: Router = Router();

reportsRouter.use(requireAuth);
reportsRouter.use(requireRole('admin', 'manager'));

reportsRouter.get(
  '/daily-sales',
  validate(DateRangeSchema, 'query'),
  ctrl.dailySales,
);
reportsRouter.get(
  '/item-wise',
  validate(DateRangeSchema, 'query'),
  ctrl.itemWiseSales,
);
reportsRouter.get(
  '/category-wise',
  validate(DateRangeSchema, 'query'),
  ctrl.categoryWiseSales,
);
reportsRouter.get(
  '/tax-summary',
  validate(DateRangeSchema, 'query'),
  ctrl.taxSummary,
);
reportsRouter.get(
  '/order-master',
  validate(OrderMasterQuerySchema, 'query'),
  ctrl.orderMaster,
);
