import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './orders.controller.js';
import {
  AddOrderItemsSchema,
  CancelOrderSchema,
  CreateOrderSchema,
  IdParamSchema,
  ListKotsQuerySchema,
  ListOrdersQuerySchema,
  OrderItemIdParamSchema,
  UpdateKotStatusSchema,
  VoidOrderItemSchema,
} from './orders.schemas.js';

/**
 * Orders + KOT routes.
 *
 * Mounted at /api/v1/orders and /api/v1/kots via two routers share a file
 * for cohesion — they're the same domain.
 *
 * Write access (creating orders, sending to kitchen, cancelling) is open
 * to any logged-in role EXCEPT 'kitchen'. Kitchen staff move KOTs through
 * states but cannot create orders. Admin and manager can do everything.
 */
export const ordersRouter: Router = Router();
export const kotsRouter: Router = Router();

ordersRouter.use(requireAuth);
kotsRouter.use(requireAuth);

const canOrder = requireRole('admin', 'manager', 'staff');
const canKitchen = requireRole('admin', 'manager', 'staff', 'kitchen');

// --- orders -----------------------------------------------------------------

ordersRouter.get('/', validate(ListOrdersQuerySchema, 'query'), ctrl.listOrders);
ordersRouter.get('/:id', validate(IdParamSchema, 'params'), ctrl.getOrder);
ordersRouter.post('/', canOrder, validate(CreateOrderSchema), ctrl.createOrder);

ordersRouter.post(
  '/:id/items',
  canOrder,
  validate(IdParamSchema, 'params'),
  validate(AddOrderItemsSchema),
  ctrl.addOrderItems,
);
ordersRouter.post(
  '/:id/items/send',
  canOrder,
  validate(IdParamSchema, 'params'),
  ctrl.sendOrderItems,
);
ordersRouter.delete(
  '/:id/items/:itemId',
  canOrder,
  validate(OrderItemIdParamSchema, 'params'),
  validate(VoidOrderItemSchema),
  ctrl.voidOrderItem,
);
ordersRouter.post(
  '/:id/cancel',
  canOrder,
  validate(IdParamSchema, 'params'),
  validate(CancelOrderSchema),
  ctrl.cancelOrder,
);

// --- kots -------------------------------------------------------------------

kotsRouter.get('/', validate(ListKotsQuerySchema, 'query'), ctrl.listKots);
kotsRouter.patch(
  '/:id/status',
  canKitchen,
  validate(IdParamSchema, 'params'),
  validate(UpdateKotStatusSchema),
  ctrl.updateKotStatus,
);
