import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './users.controller.js';
import {
  CreateUserSchema,
  IdParamSchema,
  ListUsersQuerySchema,
  ResetPasswordSchema,
  UpdateUserSchema,
} from './users.schemas.js';

/**
 * Users (staff) routes.
 *
 * Role model:
 *   - Read (list + get): admin + manager. Managers legitimately need to see
 *     the roster, even if they cannot mutate it.
 *   - All mutations (create, update, reset password): admin only.
 *     Role assignment and deactivation are privileged — a manager should
 *     not be able to promote themselves.
 */
export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

const canView = requireRole('admin', 'manager');
const canAdmin = requireRole('admin');

usersRouter.get('/', canView, validate(ListUsersQuerySchema, 'query'), ctrl.listUsers);
usersRouter.get('/:id', canView, validate(IdParamSchema, 'params'), ctrl.getUser);

usersRouter.post('/', canAdmin, validate(CreateUserSchema), ctrl.createUser);
usersRouter.patch(
  '/:id',
  canAdmin,
  validate(IdParamSchema, 'params'),
  validate(UpdateUserSchema),
  ctrl.updateUser,
);
usersRouter.post(
  '/:id/reset-password',
  canAdmin,
  validate(IdParamSchema, 'params'),
  validate(ResetPasswordSchema),
  ctrl.resetPassword,
);
