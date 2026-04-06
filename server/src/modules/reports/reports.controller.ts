import type { Request, Response, NextFunction } from 'express';
import * as service from './reports.service.js';
import { Unauthorized } from '../../utils/errors.js';
import { toCsv } from '../../utils/csv.js';
import type { DateRangeInput, OrderMasterQueryInput } from './reports.schemas.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function range(req: Request): { from?: Date; to?: Date; scope: 'outlet' | 'tenant' } {
  const q = req.query as unknown as DateRangeInput;
  return { from: q.from, to: q.to, scope: q.scope ?? 'outlet' };
}

export async function dailySales(req: Request, res: Response, next: NextFunction) {
  try {
    const r = range(req);
    res.json(await service.dailySales(authOrThrow(req), r.scope, r.from, r.to));
  } catch (err) {
    next(err);
  }
}

export async function itemWiseSales(req: Request, res: Response, next: NextFunction) {
  try {
    const r = range(req);
    res.json(await service.itemWiseSales(authOrThrow(req), r.scope, r.from, r.to));
  } catch (err) {
    next(err);
  }
}

export async function categoryWiseSales(req: Request, res: Response, next: NextFunction) {
  try {
    const r = range(req);
    res.json(await service.categoryWiseSales(authOrThrow(req), r.scope, r.from, r.to));
  } catch (err) {
    next(err);
  }
}

export async function taxSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const r = range(req);
    res.json(await service.taxSummary(authOrThrow(req), r.scope, r.from, r.to));
  } catch (err) {
    next(err);
  }
}

export async function orderMaster(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as unknown as OrderMasterQueryInput;
    const report = await service.orderMaster(authOrThrow(req), q.scope ?? 'outlet', {
      from: q.from,
      to: q.to,
      status: q.status,
      orderType: q.orderType,
    });

    if (q.format === 'csv') {
      const headers = [
        'order_number',
        'order_type',
        'status',
        'outlet',
        'table_code',
        'customer_name',
        'customer_phone',
        'opened_at',
        'closed_at',
        'bill_number',
        'bill_status',
        'subtotal_rupees',
        'discount_rupees',
        'tax_rupees',
        'total_rupees',
        'opened_by',
      ];
      const rows = report.data.map((r) => [
        r.orderNumber,
        r.orderType,
        r.status,
        r.outletName,
        r.tableCode,
        r.customerName,
        r.customerPhone,
        r.openedAt,
        r.closedAt,
        r.billNumber,
        r.billStatus,
        paiseToRupees(r.subtotalPaise),
        paiseToRupees(r.discountPaise),
        paiseToRupees(r.taxPaise),
        paiseToRupees(r.totalPaise),
        r.openedByEmail,
      ]);
      const csv = toCsv(rows, headers);
      const filename = `orders-${report.range.from.slice(0, 10)}-to-${report.range.to.slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
      return;
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
}

function paiseToRupees(p: number | null): string | null {
  if (p === null) return null;
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  return `${sign}${rupees}.${paise.toString().padStart(2, '0')}`;
}
