import { pool, withTransaction } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { Conflict, NotFound } from '../../utils/errors.js';
import * as repo from './menu.repository.js';
import type {
  CreateAddonGroupInput,
  CreateAddonInput,
  CreateCategoryInput,
  CreateItemInput,
  UpdateAddonGroupInput,
  UpdateAddonInput,
  UpdateCategoryInput,
  UpdateItemInput,
} from './menu.schemas.js';
import type { Addon, AddonGroup, Category, Item, ServiceMenu } from './menu.types.js';

/**
 * Service layer for the menu module.
 *
 * Responsibilities:
 *   - Authorisation: every call takes an AuthContext. The outletId comes
 *     from the token, never from the request body/params.
 *   - Transactions: any write that touches more than one table runs inside
 *     withTransaction so partial writes cannot leak.
 *   - Audit: every mutation writes an audit_log row with before/after.
 *   - Error translation: repository errors (FK violations, unique conflicts)
 *     become AppError instances with useful codes.
 *   - Business invariants: enforced here, not in routes.
 */

interface AuditMeta {
  requestId?: string;
  ipAddress?: string;
}

// ============================================================================
// Categories
// ============================================================================

export async function createCategory(
  actor: AuthContext,
  input: CreateCategoryInput,
  meta: AuditMeta = {},
): Promise<Category> {
  return withTransaction(async (tx) => {
    // Validate parent if provided: must exist, same outlet, and at most 1 level deep.
    if (input.parentId) {
      const parent = await repo.findCategoryById(tx, actor.outletId, input.parentId);
      if (!parent) throw NotFound('parent category', input.parentId);
      if (parent.parentId !== null) {
        throw Conflict('categories cannot nest more than 2 levels deep');
      }
    }
    const category = await repo
      .insertCategory(tx, {
        outletId: actor.outletId,
        name: input.name,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        displayOrder: input.displayOrder,
      })
      .catch(translatePgError);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_category',
      entityId: category.id,
      action: 'create',
      after: category,
      ...meta,
    });
    return category;
  });
}

export async function listCategories(
  actor: AuthContext,
  opts: { includeInactive?: boolean } = {},
): Promise<Category[]> {
  return repo.listCategories(pool, actor.outletId, {
    includeInactive: opts.includeInactive ?? false,
  });
}

export async function getCategory(actor: AuthContext, id: string): Promise<Category> {
  const category = await repo.findCategoryById(pool, actor.outletId, id);
  if (!category) throw NotFound('category', id);
  return category;
}

export async function updateCategory(
  actor: AuthContext,
  id: string,
  patch: UpdateCategoryInput,
  meta: AuditMeta = {},
): Promise<Category> {
  return withTransaction(async (tx) => {
    const before = await repo.findCategoryById(tx, actor.outletId, id);
    if (!before) throw NotFound('category', id);
    const after = await repo
      .updateCategory(tx, actor.outletId, id, patch)
      .catch(translatePgError);
    if (!after) throw NotFound('category', id);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_category',
      entityId: id,
      action: 'update',
      before,
      after,
      ...meta,
    });
    return after;
  });
}

/**
 * Soft-delete: flip is_active to false. We never hard-delete categories
 * because historical bills may reference them by name/id.
 */
export async function deactivateCategory(
  actor: AuthContext,
  id: string,
  meta: AuditMeta = {},
): Promise<Category> {
  return updateCategory(actor, id, { isActive: false }, meta);
}

// ============================================================================
// Items
// ============================================================================

export async function createItem(
  actor: AuthContext,
  input: CreateItemInput,
  meta: AuditMeta = {},
): Promise<Item> {
  return withTransaction(async (tx) => {
    // Verify the category belongs to this outlet. Cheap read before the
    // insert fails with an opaque FK error.
    const category = await repo.findCategoryById(tx, actor.outletId, input.categoryId);
    if (!category) throw NotFound('category', input.categoryId);

    const itemRow = await repo
      .insertItem(tx, {
        outletId: actor.outletId,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description ?? null,
        pricePaise: input.pricePaise,
        taxRateBps: input.taxRateBps,
        inStock: input.inStock,
        displayOrder: input.displayOrder,
        imageUrl: input.imageUrl ?? null,
        foodType: input.foodType,
        shortCode: input.shortCode ?? null,
        hsnCode: input.hsnCode ?? null,
        packingChargePaise: input.packingChargePaise,
        onlineName: input.onlineName ?? null,
        goodsOrServices: input.goodsOrServices,
        allowDecimalQty: input.allowDecimalQty,
      })
      .catch(translatePgError);

    if (input.variations.length > 0) {
      await repo.replaceVariations(
        tx,
        actor.outletId,
        itemRow.id,
        input.variations.map((v) => ({
          name: v.name,
          priceDeltaPaise: v.priceDeltaPaise,
          displayOrder: v.displayOrder,
          isActive: v.isActive,
        })),
      );
    }
    if (input.addonIds.length > 0) {
      await repo.replaceItemAddons(tx, actor.outletId, itemRow.id, input.addonIds);
    }
    if (input.addonGroupIds.length > 0) {
      await repo.replaceItemAddonGroups(tx, actor.outletId, itemRow.id, input.addonGroupIds);
    }

    const item = await repo.hydrateItem(tx, itemRow);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_item',
      entityId: item.id,
      action: 'create',
      after: item,
      ...meta,
    });
    return item;
  });
}

export async function listItems(
  actor: AuthContext,
  opts: { categoryId?: string; includeInactive?: boolean } = {},
): Promise<Item[]> {
  return repo.listItems(pool, actor.outletId, {
    categoryId: opts.categoryId,
    includeInactive: opts.includeInactive ?? false,
  });
}

export async function getItem(actor: AuthContext, id: string): Promise<Item> {
  const row = await repo.findItemRowById(pool, actor.outletId, id);
  if (!row) throw NotFound('menu item', id);
  return repo.hydrateItem(pool, row);
}

export async function updateItem(
  actor: AuthContext,
  id: string,
  patch: UpdateItemInput,
  meta: AuditMeta = {},
): Promise<Item> {
  return withTransaction(async (tx) => {
    const beforeRow = await repo.findItemRowById(tx, actor.outletId, id);
    if (!beforeRow) throw NotFound('menu item', id);
    const before = await repo.hydrateItem(tx, beforeRow);

    // If the category is being changed, validate the new category.
    if (patch.categoryId && patch.categoryId !== beforeRow.category_id) {
      const cat = await repo.findCategoryById(tx, actor.outletId, patch.categoryId);
      if (!cat) throw NotFound('category', patch.categoryId);
    }

    // Note: we pass fields through as-is so that `null` (clear the value)
    // is distinguishable from `undefined` (leave unchanged). The repository
    // uses `v !== undefined` to decide whether to include a field in SET.
    const updatedRow = await repo
      .updateItemRow(tx, actor.outletId, id, {
        categoryId: patch.categoryId,
        name: patch.name,
        description: patch.description,
        pricePaise: patch.pricePaise,
        taxRateBps: patch.taxRateBps,
        inStock: patch.inStock,
        isActive: patch.isActive,
        displayOrder: patch.displayOrder,
        imageUrl: patch.imageUrl,
        foodType: patch.foodType,
        shortCode: patch.shortCode,
        hsnCode: patch.hsnCode,
        packingChargePaise: patch.packingChargePaise,
        onlineName: patch.onlineName,
        goodsOrServices: patch.goodsOrServices,
        allowDecimalQty: patch.allowDecimalQty,
      })
      .catch(translatePgError);
    if (!updatedRow) throw NotFound('menu item', id);

    if (patch.variations !== undefined) {
      await repo.replaceVariations(
        tx,
        actor.outletId,
        id,
        patch.variations.map((v) => ({
          name: v.name,
          priceDeltaPaise: v.priceDeltaPaise,
          displayOrder: v.displayOrder,
          isActive: v.isActive,
        })),
      );
    }
    if (patch.addonIds !== undefined) {
      await repo.replaceItemAddons(tx, actor.outletId, id, patch.addonIds);
    }
    if (patch.addonGroupIds !== undefined) {
      await repo.replaceItemAddonGroups(tx, actor.outletId, id, patch.addonGroupIds);
    }

    const after = await repo.hydrateItem(tx, updatedRow);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_item',
      entityId: id,
      action: 'update',
      before,
      after,
      ...meta,
    });
    return after;
  });
}

export async function deactivateItem(
  actor: AuthContext,
  id: string,
  meta: AuditMeta = {},
): Promise<Item> {
  return updateItem(actor, id, { isActive: false }, meta);
}

/**
 * Fast-path toggle used by the POS "mark out of stock" button.
 * Semantically distinct from isActive — in-stock flips on and off all day;
 * isActive is a lifecycle state.
 */
export async function setItemInStock(
  actor: AuthContext,
  id: string,
  inStock: boolean,
  meta: AuditMeta = {},
): Promise<Item> {
  return updateItem(actor, id, { inStock }, meta);
}

// ============================================================================
// Addons
// ============================================================================

export async function createAddon(
  actor: AuthContext,
  input: CreateAddonInput,
  meta: AuditMeta = {},
): Promise<Addon> {
  return withTransaction(async (tx) => {
    const addon = await repo
      .insertAddon(tx, {
        outletId: actor.outletId,
        name: input.name,
        pricePaise: input.pricePaise,
      })
      .catch(translatePgError);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_addon',
      entityId: addon.id,
      action: 'create',
      after: addon,
      ...meta,
    });
    return addon;
  });
}

export async function listAddons(
  actor: AuthContext,
  opts: { includeInactive?: boolean } = {},
): Promise<Addon[]> {
  return repo.listAddons(pool, actor.outletId, {
    includeInactive: opts.includeInactive ?? false,
  });
}

export async function getAddon(actor: AuthContext, id: string): Promise<Addon> {
  const addon = await repo.findAddonById(pool, actor.outletId, id);
  if (!addon) throw NotFound('addon', id);
  return addon;
}

export async function updateAddon(
  actor: AuthContext,
  id: string,
  patch: UpdateAddonInput,
  meta: AuditMeta = {},
): Promise<Addon> {
  return withTransaction(async (tx) => {
    const before = await repo.findAddonById(tx, actor.outletId, id);
    if (!before) throw NotFound('addon', id);
    const after = await repo.updateAddon(tx, actor.outletId, id, patch).catch(translatePgError);
    if (!after) throw NotFound('addon', id);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_addon',
      entityId: id,
      action: 'update',
      before,
      after,
      ...meta,
    });
    return after;
  });
}

export async function deactivateAddon(
  actor: AuthContext,
  id: string,
  meta: AuditMeta = {},
): Promise<Addon> {
  return updateAddon(actor, id, { isActive: false }, meta);
}

// ============================================================================
// Addon Groups
// ============================================================================

export async function createAddonGroup(
  actor: AuthContext,
  input: CreateAddonGroupInput,
  meta: AuditMeta = {},
): Promise<AddonGroup> {
  return withTransaction(async (tx) => {
    const row = await repo
      .insertAddonGroup(tx, {
        outletId: actor.outletId,
        name: input.name,
        selectionType: input.selectionType,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
      })
      .catch(translatePgError);
    if (input.addonIds.length > 0) {
      await repo.replaceAddonGroupAddons(tx, actor.outletId, row.id, input.addonIds);
    }
    const group = await repo.hydrateAddonGroup(tx, row);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_addon_group',
      entityId: group.id,
      action: 'create',
      after: group,
      ...meta,
    });
    return group;
  });
}

export async function listAddonGroups(
  actor: AuthContext,
  opts: { includeInactive?: boolean } = {},
): Promise<AddonGroup[]> {
  return repo.listAddonGroups(pool, actor.outletId, {
    includeInactive: opts.includeInactive ?? false,
  });
}

export async function getAddonGroup(actor: AuthContext, id: string): Promise<AddonGroup> {
  const row = await repo.findAddonGroupById(pool, actor.outletId, id);
  if (!row) throw NotFound('addon group', id);
  return repo.hydrateAddonGroup(pool, row);
}

export async function updateAddonGroup(
  actor: AuthContext,
  id: string,
  patch: UpdateAddonGroupInput,
  meta: AuditMeta = {},
): Promise<AddonGroup> {
  return withTransaction(async (tx) => {
    const beforeRow = await repo.findAddonGroupById(tx, actor.outletId, id);
    if (!beforeRow) throw NotFound('addon group', id);
    const before = await repo.hydrateAddonGroup(tx, beforeRow);
    const afterRow = await repo
      .updateAddonGroup(tx, actor.outletId, id, {
        name: patch.name,
        selectionType: patch.selectionType,
        minSelections: patch.minSelections,
        maxSelections: patch.maxSelections,
        isActive: patch.isActive,
      })
      .catch(translatePgError);
    if (!afterRow) throw NotFound('addon group', id);
    if (patch.addonIds !== undefined) {
      await repo.replaceAddonGroupAddons(tx, actor.outletId, id, patch.addonIds);
    }
    const after = await repo.hydrateAddonGroup(tx, afterRow);
    await writeAudit(tx, {
      actor,
      entityType: 'menu_addon_group',
      entityId: id,
      action: 'update',
      before,
      after,
      ...meta,
    });
    return after;
  });
}

export async function deactivateAddonGroup(
  actor: AuthContext,
  id: string,
  meta: AuditMeta = {},
): Promise<AddonGroup> {
  return updateAddonGroup(actor, id, { isActive: false }, meta);
}

// ============================================================================
// Service menu (POS consumer)
// ============================================================================

export async function getServiceMenu(actor: AuthContext): Promise<ServiceMenu> {
  return repo.getServiceMenu(pool, actor.outletId);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map raw pg errors to our AppError hierarchy. Keeps service callers free
 * of pg-specific knowledge and gives clients a stable error shape.
 */
function translatePgError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e?.code === '23505') {
    // unique_violation
    throw Conflict(`duplicate: ${e.constraint ?? 'unique constraint'}`, { detail: e.detail });
  }
  if (e?.code === '23503') {
    // foreign_key_violation — surface as NotFound-ish
    throw Conflict('referenced row does not exist or is in use', { detail: e.detail });
  }
  throw err;
}
