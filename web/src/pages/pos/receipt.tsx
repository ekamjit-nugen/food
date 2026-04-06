import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBillForOrder, type BillDetail, type BillItem, type Payment } from '../../lib/billing';
import { useOrderDetail } from '../../lib/orders';
import { useTables } from '../../lib/tables';
import { useSettings, type OutletSettings } from '../../lib/settings';
import { formatPaise } from '../../lib/money';

/**
 * Print-optimised receipt view for a single bill.
 *
 * Not wrapped in <Shell> — the header chrome, sidebar, and nav would all
 * waste paper. We render a narrow, clean layout sized to look fine on a
 * browser screen AND on A5/thermal when printed. "Download PDF" is simply
 * the browser's print-to-PDF path via window.print(); we do not ship a
 * client-side PDF generator (extra dependency, not worth it for v1).
 *
 * The print-only CSS (`print:hidden`, `@media print`) hides the action bar
 * when the user hits Print so only the receipt itself lands on the page.
 */
export function PosReceiptScreen() {
  const { id: orderId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const copyType = searchParams.get('copy') ?? 'original';
  const billQuery = useBillForOrder(orderId!);
  const orderQuery = useOrderDetail(orderId ?? null);
  const tablesQuery = useTables();
  const settingsQuery = useSettings();

  // Auto-open print dialog when navigating from payment confirmation
  useAutoPrint(autoPrint && !!billQuery.data);

  const tableCode =
    orderQuery.data?.tableId && tablesQuery.data
      ? tablesQuery.data.find((t) => t.id === orderQuery.data!.tableId)?.code ?? null
      : null;

  return (
    <div className="min-h-screen bg-surface-page print:bg-white">
      <div className="mx-auto max-w-md px-4 py-6 print:max-w-none print:p-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link
            to={`/pos/order/${orderId}/bill`}
            className="text-sm text-warm-600 hover:text-warm-900"
          >
            ← Back to bill
          </Link>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-warm-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-warm-800"
          >
            Print / Save as PDF
          </button>
        </div>

        {billQuery.isLoading && <div className="text-warm-500 print:hidden">Loading…</div>}
        {billQuery.error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red print:hidden">
            {(billQuery.error as Error).message}
          </div>
        )}
        {billQuery.data === null && (
          <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-sm text-warm-500 print:hidden">
            No bill has been generated for this order yet.
          </div>
        )}

        {billQuery.data && (
          <Receipt
            bill={billQuery.data}
            orderNumber={orderQuery.data?.orderNumber ?? null}
            orderType={orderQuery.data?.orderType ?? null}
            tableCode={tableCode}
            customerName={orderQuery.data?.customerName ?? null}
            customerPhone={orderQuery.data?.customerPhone ?? null}
            settings={settingsQuery.data ?? null}
            copyType={copyType}
          />
        )}
      </div>
    </div>
  );
}

function Receipt({
  bill,
  orderNumber,
  orderType,
  tableCode,
  customerName,
  customerPhone,
  settings,
  copyType,
}: {
  bill: BillDetail;
  orderNumber: number | null;
  orderType: string | null;
  tableCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  settings: OutletSettings | null;
  copyType: string;
}) {
  // Non-voided payments only. A voided payment on the receipt would be
  // misleading — it was reversed, the customer doesn't need to see it.
  const payments = bill.payments.filter((p) => !p.isVoid);
  const outstanding = bill.totalPaise - bill.paidPaise;

  // Build the address string from structured fields
  const addressParts = [
    settings?.addressLine1,
    settings?.addressLine2,
    [settings?.city, settings?.state].filter(Boolean).join(', '),
    settings?.pincode ? `- ${settings.pincode}` : null,
  ].filter(Boolean);

  return (
    <article className="rounded-lg border border-warm-200 bg-white p-6 text-sm text-warm-900 shadow-sm print:border-none print:shadow-none print:p-4">
      {/* Business header — legally required for Indian tax invoices */}
      {settings && (
        <header className="mb-3 text-center border-b border-warm-200 pb-3">
          <h1 className="text-lg font-bold tracking-tight">{settings.name}</h1>
          {addressParts.length > 0 && (
            <p className="mt-0.5 text-[11px] text-warm-600">{addressParts.join(', ')}</p>
          )}
          {settings.phone && (
            <p className="text-[11px] text-warm-600">Phone: {settings.phone}</p>
          )}
          {settings.gstin && (
            <p className="text-[11px] text-warm-600">GSTIN: {settings.gstin}</p>
          )}
          {settings.fssaiNo && (
            <p className="text-[11px] text-warm-600">FSSAI: {settings.fssaiNo}</p>
          )}
        </header>
      )}

      <header className="mb-4 text-center">
        <h2 className="text-base font-bold tracking-tight">Tax Invoice</h2>
        <p className="mt-1 text-xs text-warm-500">
          Bill #{bill.billNumber}
          {orderNumber !== null && ` · Order #${orderNumber}`}
        </p>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-warm-500">Date</dt>
        <dd className="text-right">{new Date(bill.generatedAt).toLocaleString()}</dd>
        {orderType && (
          <>
            <dt className="text-warm-500">Type</dt>
            <dd className="text-right capitalize">{orderType.replace('_', ' ')}</dd>
          </>
        )}
        {tableCode && (
          <>
            <dt className="text-warm-500">Table</dt>
            <dd className="text-right">{tableCode}</dd>
          </>
        )}
        <dt className="text-warm-500">Status</dt>
        <dd className="text-right font-medium capitalize">{bill.status}</dd>
        {customerName && (
          <>
            <dt className="text-warm-500">Customer</dt>
            <dd className="text-right">{customerName}{customerPhone ? ` · ${customerPhone}` : ''}</dd>
          </>
        )}
      </dl>

      <table className="w-full border-t border-warm-200 text-xs">
        <thead>
          <tr className="text-warm-500">
            <th className="text-left font-medium py-1">Item</th>
            <th className="text-right font-medium py-1 w-8">Qty</th>
            <th className="text-right font-medium py-1 w-16">Unit</th>
            <th className="text-right font-medium py-1 w-20">Total</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((i) => (
            <ReceiptLine key={i.id} item={i} />
          ))}
        </tbody>
      </table>

      <div className="mt-3 border-t border-warm-200 pt-2 text-xs">
        <Row label="Subtotal" value={bill.subtotalPaise} />
        {bill.lineDiscountTotalPaise > 0 && (
          <Row label="Line discounts" value={-bill.lineDiscountTotalPaise} />
        )}
        {bill.discountPaise > 0 && (
          <Row
            label={bill.discountReason ? `Discount (${bill.discountReason})` : 'Discount'}
            value={-bill.discountPaise}
          />
        )}
        <Row label="Taxable" value={bill.taxablePaise} />
        <Row label="CGST" value={bill.cgstPaise} />
        <Row label="SGST" value={bill.sgstPaise} />
        {bill.roundOffPaise !== 0 && <Row label="Round off" value={bill.roundOffPaise} />}
        <div className="mt-1 border-t border-warm-300 pt-1">
          <Row label="Total" value={bill.totalPaise} bold />
        </div>
      </div>

      {payments.length > 0 && (
        <section className="mt-3 border-t border-warm-200 pt-2 text-xs">
          <div className="mb-1 font-medium text-warm-600">Payments</div>
          {payments.map((p) => (
            <PaymentLine key={p.id} payment={p} />
          ))}
          {bill.paidPaise > 0 && (
            <div className="mt-1 border-t border-warm-100 pt-1">
              <Row label="Paid" value={bill.paidPaise} />
            </div>
          )}
          {outstanding > 0 && bill.status !== 'void' && (
            <Row label="Outstanding" value={outstanding} bold />
          )}
        </section>
      )}

      <footer className="mt-6 text-center text-[11px] text-warm-500 space-y-1">
        <p>{settings?.receiptFooterText ?? 'Thank you for your visit.'}</p>
        <p className="uppercase font-medium text-warm-400">
          {copyType === 'duplicate' ? 'Duplicate for business' : 'Original for customer'}
        </p>
      </footer>
    </article>
  );
}

function ReceiptLine({ item }: { item: BillItem }) {
  return (
    <tr className="border-t border-warm-100 align-top">
      <td className="py-1 pr-2">
        <div>
          {item.menuItemName}
          {item.variationName && <span className="text-warm-500"> ({item.variationName})</span>}
        </div>
        {item.lineDiscountPaise > 0 && (
          <div className="text-[10px] text-warm-500">
            −{formatPaise(item.lineDiscountPaise)}
            {item.lineDiscountReason && ` · ${item.lineDiscountReason}`}
          </div>
        )}
      </td>
      <td className="py-1 text-right font-mono tabular-nums">{item.quantity}</td>
      <td className="py-1 text-right font-mono tabular-nums">{formatPaise(item.unitPricePaise)}</td>
      <td className="py-1 text-right font-mono tabular-nums">{formatPaise(item.lineTotalPaise)}</td>
    </tr>
  );
}

function PaymentLine({ payment }: { payment: Payment }) {
  return (
    <div className="flex justify-between text-warm-600">
      <span className="capitalize">
        {payment.method}
        {payment.reference && <span className="text-warm-400"> · {payment.reference}</span>}
      </span>
      <span className="font-mono tabular-nums">{formatPaise(payment.amountPaise)}</span>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={'flex justify-between ' + (bold ? 'font-semibold' : 'text-warm-600')}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{formatPaise(value)}</span>
    </div>
  );
}

/**
 * A tiny side-effect hook for callers that want the print dialog to
 * auto-open the first time the receipt mounts (e.g. navigating here
 * straight from "Record payment"). Not wired by default — leave it up to
 * the user — but exported in case we decide to opt into it later.
 */
export function useAutoPrint(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => window.print(), 200);
    return () => clearTimeout(t);
  }, [enabled]);
}
