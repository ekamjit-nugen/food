import type { Request, Response, NextFunction } from 'express';
import * as service from './orders.service.js';
import { Unauthorized } from '../../utils/errors.js';
import type { KotStatus, OrderStatus } from './orders.types.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const o = await service.createOrder(authOrThrow(req), req.body, meta(req));
    res.status(201).json(o);
  } catch (err) {
    next(err);
  }
}

export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { status?: OrderStatus; tableId?: string };
    const orders = await service.listOrders(authOrThrow(req), {
      status: q.status,
      tableId: q.tableId,
    });
    res.json({ data: orders });
  } catch (err) {
    next(err);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const o = await service.getOrderDetail(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    res.json(o);
  } catch (err) {
    next(err);
  }
}

export async function addOrderItems(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await service.addOrderItems(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.status(201).json({ data: items });
  } catch (err) {
    next(err);
  }
}

export async function sendOrderItems(req: Request, res: Response, next: NextFunction) {
  try {
    const kot = await service.sendDraftItemsToKitchen(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.status(201).json(kot);
  } catch (err) {
    next(err);
  }
}

export async function voidOrderItem(req: Request, res: Response, next: NextFunction) {
  try {
    const p = req.params as { id: string; itemId: string };
    const item = await service.voidOrderItem(
      authOrThrow(req),
      p.id,
      p.itemId,
      req.body,
      meta(req),
    );
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function cancelOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const o = await service.cancelOrder(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(o);
  } catch (err) {
    next(err);
  }
}

export async function listKots(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { status?: KotStatus; active?: string };
    const kots = await service.listKots(authOrThrow(req), {
      status: q.status,
      active: q.active === 'true',
    });
    res.json({ data: kots });
  } catch (err) {
    next(err);
  }
}

export async function updateKotStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const kot = await service.updateKotStatus(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(kot);
  } catch (err) {
    next(err);
  }
}
