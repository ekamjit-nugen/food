import type { Request, Response, NextFunction } from 'express';
import * as service from './billing.service.js';
import { Unauthorized } from '../../utils/errors.js';
import type { BillStatus } from './billing.types.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

export async function generateBillForOrder(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const bill = await service.generateBillForOrder(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.status(201).json(bill);
  } catch (err) {
    next(err);
  }
}

export async function getBillForOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const bill = await service.getBillForOrder(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    res.json(bill);
  } catch (err) {
    next(err);
  }
}

export async function listBillsForOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const bills = await service.listBillsForOrder(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    res.json({ data: bills });
  } catch (err) {
    next(err);
  }
}

export async function generateSplitBillsForOrder(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const bills = await service.generateSplitBillsForOrder(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.status(201).json({ data: bills });
  } catch (err) {
    next(err);
  }
}

export async function getBill(req: Request, res: Response, next: NextFunction) {
  try {
    const bill = await service.getBillDetail(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    res.json(bill);
  } catch (err) {
    next(err);
  }
}

export async function listBills(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { status?: BillStatus; from?: string; to?: string };
    const bills = await service.listBills(authOrThrow(req), {
      status: q.status,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    res.json({ data: bills });
  } catch (err) {
    next(err);
  }
}

export async function updateBillDiscount(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const bill = await service.updateBillDiscount(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(bill);
  } catch (err) {
    next(err);
  }
}

export async function recordPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.recordPayment(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function voidBill(req: Request, res: Response, next: NextFunction) {
  try {
    const bill = await service.voidBill(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(bill);
  } catch (err) {
    next(err);
  }
}

export async function voidPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const p = req.params as { id: string; paymentId: string };
    const result = await service.voidPayment(
      authOrThrow(req),
      p.id,
      p.paymentId,
      req.body,
      meta(req),
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function refundBill(req: Request, res: Response, next: NextFunction) {
  try {
    const bill = await service.refundBill(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(bill);
  } catch (err) {
    next(err);
  }
}
