import PDFDocument from 'pdfkit';
import type { KotWithItems } from '../orders/orders.types.js';
import type { PdfHeader } from './pdf.repository.js';

/**
 * Render a KOT (kitchen order ticket) to a PDF buffer.
 *
 * A KOT is not a bill: it has no money on it. The kitchen needs item + qty +
 * variation + add-ons + notes, big and glanceable. This renderer optimises
 * for legibility over density — larger fonts, fewer columns, prominent
 * table number at the top.
 */
export function renderKotPdf(kot: KotWithItems, header: PdfHeader): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `KOT ${kot.kotNumber}`,
        Author: header.tenantName,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- header -----------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(16).text(header.outletName, { align: 'center' });
    doc.font('Helvetica').fontSize(9).text('Kitchen Order Ticket', { align: 'center' });
    doc.moveDown(0.6);
    drawHr(doc);
    doc.moveDown(0.4);

    // --- meta block -------------------------------------------------------
    const leftCol = doc.page.margins.left;
    const rightCol = doc.page.width / 2 + 10;
    const y0 = doc.y;

    doc.font('Helvetica-Bold').fontSize(22).text(`KOT #${kot.kotNumber}`, leftCol, y0);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Order #${kot.order.orderNumber}  •  ${kot.order.orderType}`, leftCol);
    doc.text(`Sent: ${formatTime(kot.sentAt)}`, leftCol);

    const tableLine = kot.order.tableCode
      ? `TABLE ${kot.order.tableCode}`
      : kot.order.orderType === 'takeaway'
        ? 'TAKEAWAY'
        : '';
    if (tableLine) {
      const yRight = y0;
      doc
        .font('Helvetica-Bold')
        .fontSize(28)
        .text(tableLine, rightCol, yRight, {
          width: doc.page.width - doc.page.margins.right - rightCol,
          align: 'right',
        });
    }

    doc.moveDown(0.6);
    drawHr(doc);
    doc.moveDown(0.4);

    // --- items ------------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(12);
    const qtyX = leftCol;
    const itemX = leftCol + 40;
    const headerY = doc.y;
    doc.text('Qty', qtyX, headerY, { width: 36, align: 'left' });
    doc.text('Item', itemX, headerY);
    doc.moveDown(0.3);
    drawHr(doc);
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(12);
    const liveItems = kot.items.filter((i) => !i.isVoid);
    for (const it of liveItems) {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(14).text(`${it.quantity}×`, qtyX, y, { width: 36 });
      const name = it.variationName ? `${it.menuItemName} — ${it.variationName}` : it.menuItemName;
      doc.font('Helvetica-Bold').fontSize(13).text(name, itemX, y);
      if (it.addons.length > 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#333');
        for (const a of it.addons) {
          doc.text(`   + ${a.name}`, itemX);
        }
        doc.fillColor('black');
      }
      if (it.notes) {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor('#a00');
        doc.text(`   note: ${it.notes}`, itemX);
        doc.fillColor('black');
      }
      doc.moveDown(0.3);
    }

    if (liveItems.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(11)
        .fillColor('#a00')
        .text('All items on this KOT have been voided.', leftCol);
      doc.fillColor('black');
    }

    // --- footer -----------------------------------------------------------
    doc.moveDown(1.5);
    drawHr(doc);
    doc.moveDown(0.3);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666');
    doc.text(`Status: ${kot.status}  •  Reprint generated ${formatTime(new Date())}`, { align: 'center' });
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

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
