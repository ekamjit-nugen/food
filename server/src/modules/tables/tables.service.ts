import { pool, withTransaction } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { AppError, Conflict, ErrorCode, NotFound } from '../../utils/errors.js';
import * as repo from './tables.repository.js';
import type {
  BulkCreateTablesInput,
  CreateTableInput,
  UpdateTableInput,
} from './tables.schemas.js';
import type { DiningTable } from './tables.types.js';

interface AuditMeta {
  requestId?: string;
  ipAddress?: string;
}

export async function createTable(
  actor: AuthContext,
  input: CreateTableInput,
  meta: AuditMeta = {},
): Promise<DiningTable> {
  return withTransaction(async (tx) => {
    const table = await repo
      .insertTable(tx, {
        outletId: actor.outletId,
        code: input.code,
        label: input.label ?? null,
        section: input.section ?? null,
        seats: input.seats,
        displayOrder: input.displayOrder,
      })
      .catch(translatePgError);
    await writeAudit(tx, {
      actor,
      entityType: 'dining_table',
      entityId: table.id,
      action: 'create',
      after: table,
      ...meta,
    });
    return table;
  });
}

/**
 * Bulk-create N tables in a single transaction. If any row conflicts
 * (duplicate code), the entire request rolls back — we never want to
 * end up with a half-seeded floor.
 */
export async function bulkCreateTables(
  actor: AuthContext,
  input: BulkCreateTablesInput,
  meta: AuditMeta = {},
): Promise<DiningTable[]> {
  return withTransaction(async (tx) => {
    const created: DiningTable[] = [];
    for (const t of input.tables) {
      const row = await repo
        .insertTable(tx, {
          outletId: actor.outletId,
          code: t.code,
          label: t.label ?? null,
          section: t.section ?? null,
          seats: t.seats,
          displayOrder: t.displayOrder,
        })
        .catch(translatePgError);
      created.push(row);
    }
    // One audit row for the whole batch. Individual ids are in `after`.
    await writeAudit(tx, {
      actor,
      entityType: 'dining_table',
      entityId: `bulk:${created.length}`,
      action: 'create',
      after: { ids: created.map((t) => t.id), count: created.length },
      ...meta,
    });
    return created;
  });
}

export async function listTables(
  actor: AuthContext,
  opts: { includeInactive?: boolean; section?: string } = {},
): Promise<DiningTable[]> {
  return repo.listTables(pool, actor.outletId, {
    includeInactive: opts.includeInactive ?? false,
    section: opts.section,
  });
}

export async function getTable(actor: AuthContext, id: string): Promise<DiningTable> {
  const table = await repo.findTableById(pool, actor.outletId, id);
  if (!table) throw NotFound('dining table', id);
  return table;
}

export async function updateTable(
  actor: AuthContext,
  id: string,
  patch: UpdateTableInput,
  meta: AuditMeta = {},
): Promise<DiningTable> {
  return withTransaction(async (tx) => {
    const before = await repo.findTableById(tx, actor.outletId, id);
    if (!before) throw NotFound('dining table', id);
    const after = await repo
      .updateTable(tx, actor.outletId, id, patch)
      .catch(translatePgError);
    if (!after) throw NotFound('dining table', id);
    await writeAudit(tx, {
      actor,
      entityType: 'dining_table',
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
 * Soft-delete. We never hard-delete a table because historical orders
 * reference it. Deactivating hides it from the POS floor plan but keeps
 * it in reports.
 *
 * Refuses to deactivate a table that currently has an open order — doing
 * so would orphan the order from the POS floor plan and risk unbilled
 * revenue.
 */
export async function deactivateTable(
  actor: AuthContext,
  id: string,
  meta: AuditMeta = {},
): Promise<DiningTable> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM orders
      WHERE outlet_id = $1 AND table_id = $2 AND status = 'open'
      LIMIT 1`,
    [actor.outletId, id],
  );
  if (rows.length > 0) {
    throw new AppError({ statusCode: 409, code: ErrorCode.TABLE_HAS_ORDER, message: 'Cannot deactivate table with an open order. Close or cancel the order first.' });
  }
  return updateTable(actor, id, { isActive: false }, meta);
}

// ---- helpers --------------------------------------------------------------

function translatePgError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e?.code === '23505') {
    throw new AppError({ statusCode: 409, code: ErrorCode.TABLE_CODE_EXISTS, message: `A table with this code already exists`, details: { detail: e.detail } });
  }
  throw err;
}
