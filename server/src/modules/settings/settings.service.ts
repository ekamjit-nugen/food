import { pool } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { NotFound } from '../../utils/errors.js';
import * as repo from './settings.repository.js';
import type {
  UpdateBusinessInput,
  UpdateTaxInput,
  UpdateBillingInput,
  UpdateOperationsInput,
} from './settings.schemas.js';

export async function getSettings(actor: AuthContext) {
  const settings = await repo.getSettings(pool, actor.outletId);
  if (!settings) throw NotFound('outlet settings');
  return settings;
}

export async function updateBusiness(actor: AuthContext, input: UpdateBusinessInput) {
  await repo.updateOutlet(pool, actor.outletId, {
    name: input.name,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    pincode: input.pincode,
    phone: input.phone,
    email: input.email,
  });
  return getSettings(actor);
}

export async function updateTax(actor: AuthContext, input: UpdateTaxInput) {
  await repo.updateOutlet(pool, actor.outletId, {
    gstin: input.gstin,
    fssaiNo: input.fssaiLicense,
    defaultTaxRateBps: input.defaultTaxRateBps,
  });
  return getSettings(actor);
}

export async function updateBilling(actor: AuthContext, input: UpdateBillingInput) {
  await repo.updateOutlet(pool, actor.outletId, {
    billNumberPrefix: input.billNumberPrefix,
    receiptFooterText: input.receiptFooterText,
    maxDiscountBps: input.maxDiscountBps,
  });
  return getSettings(actor);
}

export async function updateOperations(actor: AuthContext, input: UpdateOperationsInput) {
  await repo.updateOutlet(pool, actor.outletId, {
    kotWarningMinutes: input.kotWarningMinutes,
    kotUrgentMinutes: input.kotUrgentMinutes,
    autoRestock: input.autoRestock,
    autoRestockTime: input.autoRestockTime,
  });
  return getSettings(actor);
}
