import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './tables.controller.js';
import {
  BulkCreateTablesSchema,
  CreateTableSchema,
  IdParamSchema,
  UpdateTableSchema,
} from './tables.schemas.js';

/**
 * Tables routes, mounted at /api/v1/tables.
 *
 * Reads available to any authenticated user (POS needs them).
 * Writes restricted to admin / manager — regular staff cannot change
 * the floor plan mid-service.
 */
export const tablesRouter: Router = Router();

tablesRouter.use(requireAuth);

const canEdit = requireRole('admin', 'manager');

tablesRouter.get('/', ctrl.listTables);
tablesRouter.get('/:id', validate(IdParamSchema, 'params'), ctrl.getTable);

tablesRouter.post('/', canEdit, validate(CreateTableSchema), ctrl.createTable);
tablesRouter.post(
  '/bulk',
  canEdit,
  validate(BulkCreateTablesSchema),
  ctrl.bulkCreateTables,
);
tablesRouter.patch(
  '/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  validate(UpdateTableSchema),
  ctrl.updateTable,
);
tablesRouter.delete(
  '/:id',
  canEdit,
  validate(IdParamSchema, 'params'),
  ctrl.deactivateTable,
);
