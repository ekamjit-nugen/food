import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './menu.controller.js';
import {
  CreateAddonGroupSchema,
  CreateAddonSchema,
  CreateCategorySchema,
  CreateItemSchema,
  IdParamSchema,
  UpdateAddonGroupSchema,
  UpdateAddonSchema,
  UpdateCategorySchema,
  UpdateItemSchema,
} from './menu.schemas.js';

/**
 * Menu routes.
 *
 * Auth model:
 *   - Read routes: any authenticated user (POS, kitchen, admin).
 *   - Write routes: admin or manager only. Kitchen/staff cannot edit menu.
 *
 * All routes are mounted under /api/v1/menu from app.ts.
 */
export const menuRouter: Router = Router();

menuRouter.use(requireAuth);

const canEdit = requireRole('admin', 'manager');

// -- Service menu (the POS consumer) ----------------------------------------
menuRouter.get('/', ctrl.getServiceMenu);

// -- Categories -------------------------------------------------------------
menuRouter.get('/categories', ctrl.listCategories);
menuRouter.get(
  '/categories/:id',
  validate(IdParamSchema, 'params'),
  ctrl.getCategory,
);
menuRouter.post(
  '/categories',
  canEdit,
  validate(CreateCategorySchema),
  ctrl.createCategory,
);
menuRouter.patch(
  '/categories/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  validate(UpdateCategorySchema),
  ctrl.updateCategory,
);
menuRouter.delete(
  '/categories/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  ctrl.deactivateCategory,
);

// -- Items ------------------------------------------------------------------
menuRouter.get('/items', ctrl.listItems);
menuRouter.get('/items/:id', validate(IdParamSchema, 'params'), ctrl.getItem);
menuRouter.post('/items', canEdit, validate(CreateItemSchema), ctrl.createItem);
menuRouter.patch(
  '/items/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  validate(UpdateItemSchema),
  ctrl.updateItem,
);
menuRouter.delete(
  '/items/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  ctrl.deactivateItem,
);
// Dedicated fast-path for the POS "mark out of stock" toggle.
menuRouter.post(
  '/items/:id/in-stock',
  canEdit,
  validate(IdParamSchema, 'params'),
  validate(z.object({ inStock: z.boolean() }).strict()),
  ctrl.setItemInStock,
);

// -- Addons -----------------------------------------------------------------
menuRouter.get('/addons', ctrl.listAddons);
menuRouter.get('/addons/:id', validate(IdParamSchema, 'params'), ctrl.getAddon);
menuRouter.post('/addons', canEdit, validate(CreateAddonSchema), ctrl.createAddon);
menuRouter.patch(
  '/addons/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  validate(UpdateAddonSchema),
  ctrl.updateAddon,
);
menuRouter.delete(
  '/addons/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  ctrl.deactivateAddon,
);

// -- Addon Groups -----------------------------------------------------------
menuRouter.get('/addon-groups', ctrl.listAddonGroups);
menuRouter.get('/addon-groups/:id', validate(IdParamSchema, 'params'), ctrl.getAddonGroup);
menuRouter.post('/addon-groups', canEdit, validate(CreateAddonGroupSchema), ctrl.createAddonGroup);
menuRouter.patch(
  '/addon-groups/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  validate(UpdateAddonGroupSchema),
  ctrl.updateAddonGroup,
);
menuRouter.delete(
  '/addon-groups/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  ctrl.deactivateAddonGroup,
);
