import { pool } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { Forbidden, NotFound } from '../../utils/errors.js';
import * as repo from './outlets.repository.js';
import type { CreateOutletInput, UpdateOutletInput } from './outlets.schemas.js';

export async function listOutlets(actor: AuthContext) {
  return repo.listByTenant(pool, actor.tenantId);
}

export async function getOutlet(actor: AuthContext, id: string) {
  const outlet = await repo.findById(pool, actor.tenantId, id);
  if (!outlet) throw NotFound('outlet', id);
  return outlet;
}

export async function createOutlet(actor: AuthContext, input: CreateOutletInput) {
  if (!actor.isTenantOwner && actor.role !== 'admin') {
    throw Forbidden('only tenant owners and admins can create outlets');
  }
  return repo.insert(pool, actor.tenantId, input.name);
}

export async function updateOutlet(actor: AuthContext, id: string, input: UpdateOutletInput) {
  if (!actor.isTenantOwner && actor.role !== 'admin') {
    throw Forbidden('only tenant owners and admins can update outlets');
  }
  const updated = await repo.update(pool, actor.tenantId, id, input);
  if (!updated) throw NotFound('outlet', id);
  return updated;
}
