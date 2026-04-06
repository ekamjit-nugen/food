import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './billing.controller.js';
import {
  GenerateBillSchema,
  GenerateSplitBillsSchema,
  IdParamSchema,
  PaymentIdParamSchema,
  RecordPaymentSchema,
  RefundBillSchema,
  UpdateDiscountSchema,
  VoidBillSchema,
  VoidPaymentSchema,
} from './billing.schemas.js';

/**
 * Billing routes are split into two mounts so generation hangs off the
 * order resource (the common path: "I'm done with table 5, bill it") and
 * all subsequent operations hang off the bill id (discount, payment, void).
 *
 * Role model:
 *   - Generating a bill and recording payments: admin, manager, staff.
 *     (Kitchen never touches billing.)
 *   - Voiding a bill or applying a discount: admin, manager ONLY.
 *     Discounts move money; make it a supervisor action.
 */
export const billingOrdersRouter: Router = Router();
export const billsRouter: Router = Router();

billingOrdersRouter.use(requireAuth);
billsRouter.use(requireAuth);

const canBill = requireRole('admin', 'manager', 'staff');
const canSupervise = requireRole('admin', 'manager');

// --- mounted under /api/v1/orders/:id ---------------------------------------

billingOrdersRouter.post(
  '/:id/bill',
  canBill,
  validate(IdParamSchema, 'params'),
  validate(GenerateBillSchema),
  ctrl.generateBillForOrder,
);
// Split-bill generation. Creates multiple bills on the same order in one
// atomic transaction. Same role gate as the single-bill path — splitting is
// a normal day-to-day action, not a supervisor override.
billingOrdersRouter.post(
  '/:id/bills/split',
  canBill,
  validate(IdParamSchema, 'params'),
  validate(GenerateSplitBillsSchema),
  ctrl.generateSplitBillsForOrder,
);
billingOrdersRouter.get(
  '/:id/bill',
  validate(IdParamSchema, 'params'),
  ctrl.getBillForOrder,
);
// Plural: list every bill on the order. Use this when the order has been
// split — the singular endpoint above 409s in that case.
billingOrdersRouter.get(
  '/:id/bills',
  validate(IdParamSchema, 'params'),
  ctrl.listBillsForOrder,
);

// --- /api/v1/bills ----------------------------------------------------------

billsRouter.get('/', ctrl.listBills);
billsRouter.get('/:id', validate(IdParamSchema, 'params'), ctrl.getBill);
billsRouter.patch(
  '/:id/discount',
  canSupervise,
  validate(IdParamSchema, 'params'),
  validate(UpdateDiscountSchema),
  ctrl.updateBillDiscount,
);
billsRouter.post(
  '/:id/payments',
  canBill,
  validate(IdParamSchema, 'params'),
  validate(RecordPaymentSchema),
  ctrl.recordPayment,
);
billsRouter.post(
  '/:id/void',
  canSupervise,
  validate(IdParamSchema, 'params'),
  validate(VoidBillSchema),
  ctrl.voidBill,
);

// Refund a paid bill. Distinct from void (which only handles unpaid bills):
// this voids all payments, voids the bill, and cancels the parent order.
billsRouter.post(
  '/:id/refund',
  canSupervise,
  validate(IdParamSchema, 'params'),
  validate(RefundBillSchema),
  ctrl.refundBill,
);

// Void a single payment (correction flow). If the bill had flipped to
// 'paid', it reverts to 'open' and the order re-opens.
billsRouter.post(
  '/:id/payments/:paymentId/void',
  canSupervise,
  validate(PaymentIdParamSchema, 'params'),
  validate(VoidPaymentSchema),
  ctrl.voidPayment,
);
