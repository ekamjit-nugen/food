import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { CreateOutletSchema, UpdateOutletSchema, IdParamSchema } from './outlets.schemas.js';
import * as ctrl from './outlets.controller.js';

export const outletsRouter = Router();

outletsRouter.use(requireAuth);

// Any authenticated user can list/view outlets (needed for outlet switcher)
outletsRouter.get('/', ctrl.list);
outletsRouter.get('/:id', validate(IdParamSchema, 'params'), ctrl.get);

// Only admin/owner can create or update
outletsRouter.post('/', requireRole('admin'), validate(CreateOutletSchema), ctrl.create);
outletsRouter.patch('/:id', requireRole('admin'), validate(IdParamSchema, 'params'), validate(UpdateOutletSchema), ctrl.update);
