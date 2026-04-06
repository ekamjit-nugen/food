import PDFDocument from 'pdfkit';
import { formatPaise } from '../../utils/money.js';
import type { BillDetail } from '../billing/billing.types.js';
import type { PdfHeader } from './pdf.repository.js';

/**
 * Render a bill to a PDF buffer.
 *
 * Layout is intentionally plain — this is a reprint, not a design artefact.
 * Target medium is a phone/tablet screen or a WhatsApp forward, not thermal
 * paper (v1 has no ESC/POS printer support). We use A4 with generous margins
 * so the output is legible on both a desktop preview and a 6" phone screen.
 *
 * Built-in Helvetica is used for everything. We deliberately do NOT load
 * custom fonts — pdfkit ships with a compact subset that's good enough for
 * Latin + digits + the rupee sign (₹ is available in pdfkit's built-in
 * Helvetica glyph table on all platforms we support).
 *
 * All money is formatted through formatPaise so rupee signs and rounding
 * match the rest of the app exactly. Never compute currency here.
 */
export function renderBillPdf(bill: BillDetail, header: PdfHeader): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Bill ${bill.billNumber}`,
        Author: header.tenantName,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- header -----------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(18).text(header.tenantName, { align: 'center' });
    doc.font('Helvetica').fontSize(11).text(header.outletName, { align: 'center' });
    if (header.address) {
      doc.fontSize(9).text(header.address, { align: 'center' });
    }
    if (header.phone) {
      doc.fontSize(9).text(`Phone: ${header.phone}`, { align: 'center' });
    }
    const legal: string[] = [];
    if (header.gstin) legal.push(`GSTIN: ${header.gstin}`);
    if (header.fssaiNo) legal.push(`FSSAI: ${header.fssaiNo}`);
    if (legal.length > 0) {
      doc.fontSize(9).text(legal.join('   •   '), { align: 'center' });
    }

    doc.moveDown(0.7);
    drawHr(doc);
    doc.moveDown(0.5);

    // --- bill meta --------------------------------------------------------
    const paidLabel = bill.status === 'paid' ? ' (PAID)' : bill.status === 'void' ? ' (VOID)' : '';
    doc.font('Helvetica-Bold').fontSize(13).text(`Bill #${bill.billNumber}${paidLabel}`);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Generated: ${formatDateTime(bill.generatedAt)}`);
    if (bill.paidAt) {
      doc.text(`Paid: ${formatDateTime(bill.paidAt)}`);
    }
    doc.moveDown(0.5);
    drawHr(doc);
    doc.moveDown(0.4);

    // --- item table -------------------------------------------------------
    // Columns: Item | Qty | Unit | Total
    const startX = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;
    const col = {
      item: startX,
      qty: rightX - 220,
      unit: rightX - 150,
      total: rightX - 75,
    };

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Item', col.item, doc.y, { continued: false });
    const rowY = doc.y - doc.currentLineHeight();
    doc.text('Qty', col.qty, rowY, { width: 40, align: 'right' });
    doc.text('Unit', col.unit, rowY, { width: 70, align: 'right' });
    doc.text('Total', col.total, rowY, { width: 70, align: 'right' });
    doc.moveDown(0.3);
    drawHr(doc);
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(10);
    for (const it of bill.items) {
      const name = it.variationName ? `${it.menuItemName} — ${it.variationName}` : it.menuItemName;
      const y = doc.y;
      doc.text(name, col.item, y, { width: col.qty - col.item - 4 });
      const lineBottom = doc.y;
      doc.text(String(it.quantity), col.qty, y, { width: 40, align: 'right' });
      doc.text(formatPaise(it.unitPricePaise), col.unit, y, { width: 70, align: 'right' });
      doc.text(formatPaise(it.lineTotalPaise), col.total, y, { width: 70, align: 'right' });
      // The item name may wrap; reset y to whichever column went lowest.
      doc.y = lineBottom;
      if (it.lineDiscountPaise > 0) {
        doc
          .fontSize(8)
          .fillColor('#666')
          .text(
            `   discount: -${formatPaise(it.lineDiscountPaise)}` +
              (it.lineDiscountReason ? ` (${it.lineDiscountReason})` : ''),
            col.item,
          );
        doc.fillColor('black').fontSize(10);
      }
    }

    doc.moveDown(0.4);
    drawHr(doc);
    doc.moveDown(0.3);

    // --- totals block (right-aligned) -------------------------------------
    const totalsX = col.unit;
    const totalsLabelW = col.total - col.unit - 4;
    const totalsValW = 70;
    const row = (label: string, value: string, bold = false) => {
      if (bold) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');
      const y = doc.y;
      doc.text(label, totalsX, y, { width: totalsLabelW, align: 'right' });
      doc.text(value, col.total, y, { width: totalsValW, align: 'right' });
      doc.moveDown(0.2);
    };

    doc.fontSize(10);
    row('Subtotal', formatPaise(bill.subtotalPaise));
    if (bill.lineDiscountTotalPaise > 0) {
      row('Line discounts', `-${formatPaise(bill.lineDiscountTotalPaise)}`);
    }
    if (bill.discountPaise > 0) {
      const reason = bill.discountReason ? ` (${bill.discountReason})` : '';
      row(`Discount${reason}`, `-${formatPaise(bill.discountPaise)}`);
    }
    row('Taxable', formatPaise(bill.taxablePaise));
    row('CGST', formatPaise(bill.cgstPaise));
    row('SGST', formatPaise(bill.sgstPaise));
    if (bill.roundOffPaise !== 0) {
      row('Round off', formatPaise(bill.roundOffPaise));
    }
    doc.moveDown(0.2);
    drawHr(doc);
    doc.moveDown(0.2);
    row('TOTAL', formatPaise(bill.totalPaise), true);

    if (bill.paidPaise > 0) {
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      row('Paid', formatPaise(bill.paidPaise));
      const due = bill.totalPaise - bill.paidPaise;
      if (due > 0) row('Due', formatPaise(due), true);
    }

    // --- payment list -----------------------------------------------------
    const livePayments = bill.payments.filter((p) => !p.isVoid);
    if (livePayments.length > 0) {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(10).text('Payments', startX);
      doc.font('Helvetica').fontSize(9);
      for (const p of livePayments) {
        const line = `${formatDateTime(p.receivedAt)}  •  ${p.method.toUpperCase()}  •  ${formatPaise(p.amountPaise)}` +
          (p.reference ? `  •  ref ${p.reference}` : '');
        doc.text(line, startX);
      }
    }

    // --- footer -----------------------------------------------------------
    doc.moveDown(1.5);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666');
    doc.text('This is a system-generated reprint. Retain for your records.', { align: 'center' });
    doc.fillColor('black');

    doc.end();
  });
}

function drawHr(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc
    .strokeColor('#ccc')
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.strokeColor('black');
}

function formatDateTime(d: Date): string {
  // Plain local-time format. Outlets in v1 all run IST; when we go
  // multi-timezone we can plug the outlet's timezone in here.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
