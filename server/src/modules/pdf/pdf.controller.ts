import type { Request, Response, NextFunction } from 'express';
import { Unauthorized } from '../../utils/errors.js';
import * as service from './pdf.service.js';

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  // `inline` so the mobile app / browser can preview without forcing a
  // download. A user can still save-as from the preview.
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.byteLength));
  // Stateful reprints shouldn't be cached — a later discount edit or void
  // must be visible on the next reprint.
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(buffer);
}

export async function getBillPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const { buffer, filename } = await service.renderBill(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    sendPdf(res, buffer, filename);
  } catch (err) {
    next(err);
  }
}

export async function getKotPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const { buffer, filename } = await service.renderKot(
      authOrThrow(req),
      (req.params as { id: string }).id,
    );
    sendPdf(res, buffer, filename);
  } catch (err) {
    next(err);
  }
}
