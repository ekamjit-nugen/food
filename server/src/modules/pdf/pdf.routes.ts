import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './pdf.controller.js';

/**
 * PDF reprint routes.
 *
 * Two tiny routers that attach extra GET handlers to /api/v1/bills and
 * /api/v1/kots. Separate from the main billing/orders route files so the
 * PDF dependency (pdfkit) only loads when you actually import this module
 * at app-wire time — keeps billing + orders unit tests free of any PDF
 * surface area.
 *
 * Authorisation mirrors the parent list endpoints: any authenticated user
 * can read a bill or KOT in their outlet, and the underlying getBillDetail
 * / getKotDetail calls already enforce outlet scoping. No additional role
 * gate — the friend's staff needs to reprint a bill during service, not
 * chase down an admin.
 */

const IdParamSchema = z.object({ id: z.string().uuid() });

export const billsPdfRouter: Router = Router();
billsPdfRouter.use(requireAuth);
billsPdfRouter.get(
  '/:id/pdf',
  validate(IdParamSchema, 'params'),
  ctrl.getBillPdf,
);

export const kotsPdfRouter: Router = Router();
kotsPdfRouter.use(requireAuth);
kotsPdfRouter.get(
  '/:id/pdf',
  validate(IdParamSchema, 'params'),
  ctrl.getKotPdf,
);
