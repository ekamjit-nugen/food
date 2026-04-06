import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './alerts.controller.js';
import {
  AlertIdParamSchema,
  CreateAlertSchema,
  ListAlertsQuerySchema,
} from './alerts.schemas.js';

/**
 * Service alert routes, mounted at /api/v1/alerts.
 *
 * All endpoints require authentication — alerts are per-outlet and the
 * outlet is resolved from the JWT via requireAuth. No role gate: raising
 * and acking are open to every authenticated user. See alerts.service.ts
 * for the rationale (the buttons exist to remove friction; gating defeats
 * their purpose, and we still have the audit log).
 */
export const alertsRouter: Router = Router();

alertsRouter.use(requireAuth);

alertsRouter.get('/', validate(ListAlertsQuerySchema, 'query'), ctrl.listAlerts);

alertsRouter.post('/', validate(CreateAlertSchema), ctrl.createAlert);

alertsRouter.post(
  '/:id/ack',
  validate(AlertIdParamSchema, 'params'),
  ctrl.ackAlert,
);
