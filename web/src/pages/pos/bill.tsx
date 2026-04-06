import { useState, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../shell';
import { ApiError, useAuth } from '../../lib/auth';
import {
  useBillForOrder,
  useGenerateBill,
  useRecordPayment,
  useRefundBill,
  useUpdateBillDiscount,
  useVoidBill,
  useVoidPayment,
  type BillDetail,
  type BillItem,
  type DiscountInput,
  type Payment,
  type PaymentMethod,
} from '../../lib/billing';
import { formatPaise, parseAmountToPaise } from '../../lib/money';

/**
 * Billing screen for a single order.
 *
 * Supervisor actions (discount, void bill, refund, void payment) render
 * behind a role gate — only admin + manager see them. Each destructive
 * action opens a PromptModal that requires a reason before it fires; the
 * reason is surfaced on the audit log server-side.
 *
 * Split-bill orders are out of scope for this screen (backend 409s on the
 * singular endpoint). Split UX will get its own screen.
 */
export function PosBillScreen() {
  const { id: orderId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const billQuery = useBillForOrder(orderId!);
  const generate = useGenerateBill();
  const [genError, setGenError] = useState<string | null>(null);

  async function onGenerate() {
    setGenError(null);
    try {
      await generate.mutateAsync(orderId!);
    } catch (err) {
      setGenError(err instanceof ApiError ? err.message : 'failed to generate bill');
    }
  }

  return (
    <Shell title="Bill">
      <div className="mb-4">
        <Link to={`/pos/order/${orderId}`} className="text-sm text-warm-500 hover:text-warm-700">
          ← Back to order
        </Link>
      </div>

      {billQuery.isLoading && <div className="text-warm-500">Loading…</div>}

      {billQuery.error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(billQuery.error as Error).message}
        </div>
      )}

      {billQuery.data === null && (
        <div className="rounded-lg border border-dashed border-warm-300 bg-white p-8 text-center">
          <p className="text-warm-600 mb-4">No bill has been generated for this order yet.</p>
          {genError && <div className="mb-3 text-sm text-status-red">{genError}</div>}
          <button
            onClick={onGenerate}
            disabled={generate.isPending}
            className="btn-primary"
          >
            {generate.isPending ? 'Generating…' : 'Generate bill'}
          </button>
        </div>
      )}

      {billQuery.data && (
        <BillView bill={billQuery.data} orderId={orderId!} onDone={() => navigate('/pos')} />
      )}
    </Shell>
  );
}

function BillView({
  bill,
  orderId,
  onDone,
}: {
  bill: BillDetail;
  orderId: string;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'admin' || user?.role === 'manager';
  const outstanding = bill.totalPaise - bill.paidPaise;
  const settled = bill.status === 'paid';
  const voided = bill.status === 'void';
  const hasPayments = bill.payments.some((p) => !p.isVoid);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,22rem] gap-4">
      <div className="rounded-lg border border-warm-200 bg-white p-4">
        <header className="flex items-baseline justify-between mb-3 gap-3">
          <div>
            <h2 className="text-lg font-semibold">Bill #{bill.billNumber}</h2>
            <p className="text-xs text-warm-500">
              Status: <span className="font-medium">{bill.status}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {voided && bill.voidReason && (
              <div className="rounded-md bg-status-red-light border border-status-red/20 px-2 py-1 text-xs text-status-red">
                Voided: {bill.voidReason}
              </div>
            )}
            <Link
              to={`/pos/order/${orderId}/receipt`}
              className="btn-secondary text-xs"
            >
              Print receipt
            </Link>
          </div>
        </header>

        <table className="w-full text-sm">
          <thead className="text-warm-500">
            <tr>
              <th className="text-left font-medium py-1">Item</th>
              <th className="text-right font-medium py-1">Qty</th>
              <th className="text-right font-medium py-1">Unit</th>
              <th className="text-right font-medium py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </tbody>
        </table>

        <div className="mt-4 pt-3 border-t border-warm-100 space-y-1 text-sm">
          <TotalRow label="Subtotal" value={bill.subtotalPaise} />
          {bill.lineDiscountTotalPaise > 0 && (
            <TotalRow label="Line discounts" value={-bill.lineDiscountTotalPaise} muted />
          )}
          {bill.discountPaise > 0 && (
            <TotalRow
              label={bill.discountReason ? `Discount (${bill.discountReason})` : 'Discount'}
              value={-bill.discountPaise}
              muted
            />
          )}
          <TotalRow label="Taxable" value={bill.taxablePaise} muted />
          <TotalRow label="CGST" value={bill.cgstPaise} muted />
          <TotalRow label="SGST" value={bill.sgstPaise} muted />
          {bill.roundOffPaise !== 0 && (
            <TotalRow label="Round off" value={bill.roundOffPaise} muted />
          )}
          <div className="pt-2 border-t border-warm-100">
            <TotalRow label="Total" value={bill.totalPaise} bold />
          </div>
          {bill.paidPaise > 0 && <TotalRow label="Paid" value={bill.paidPaise} muted />}
          {!settled && !voided && outstanding > 0 && (
            <TotalRow label="Outstanding" value={outstanding} bold />
          )}
        </div>
      </div>

      <aside className="space-y-3">
        {bill.payments.length > 0 && (
          <PaymentsList
            payments={bill.payments}
            bill={bill}
            orderId={orderId}
            isSupervisor={isSupervisor}
          />
        )}

        {!settled && !voided && outstanding > 0 && (
          <RecordPaymentForm bill={bill} orderId={orderId} outstanding={outstanding} />
        )}

        {isSupervisor && !voided && (
          <SupervisorActions
            bill={bill}
            orderId={orderId}
            hasPayments={hasPayments}
            settled={settled}
          />
        )}

        {settled && (
          <div className="rounded-lg border border-status-green/20 bg-status-green-light p-4">
            <div className="text-sm font-medium text-status-green">Bill paid in full.</div>
            <button
              onClick={onDone}
              className="btn-primary mt-3 w-full"
            >
              Back to tables
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function ItemRow({ item }: { item: BillItem }) {
  return (
    <tr className="border-t border-warm-100">
      <td className="py-1.5">
        <div className="text-warm-900">
          {item.menuItemName}
          {item.variationName && <span className="text-warm-500"> ({item.variationName})</span>}
        </div>
        {item.lineDiscountPaise > 0 && (
          <div className="text-xs text-warm-500">
            Line discount: −{formatPaise(item.lineDiscountPaise)}
            {item.lineDiscountReason && ` · ${item.lineDiscountReason}`}
          </div>
        )}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">{item.quantity}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">{formatPaise(item.unitPricePaise)}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">{formatPaise(item.lineTotalPaise)}</td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={
        'flex items-baseline justify-between ' +
        (bold ? 'text-base font-semibold' : muted ? 'text-warm-500' : '')
      }
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{formatPaise(value)}</span>
    </div>
  );
}

function PaymentsList({
  payments,
  bill,
  orderId,
  isSupervisor,
}: {
  payments: Payment[];
  bill: BillDetail;
  orderId: string;
  isSupervisor: boolean;
}) {
  const voidPayment = useVoidPayment(orderId);
  const [prompt, setPrompt] = useState<{ paymentId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (payments.length === 0) return null;
  return (
    <div className="rounded-lg border border-warm-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-500 mb-2">
        Payments
      </h3>
      {error && (
        <div className="mb-2 rounded-md bg-status-red-light border border-status-red/20 px-2 py-1 text-xs text-status-red">
          {error}
        </div>
      )}
      <ul className="space-y-1 text-sm">
        {payments.map((p) => {
          const voidedStyle = p.isVoid ? 'text-warm-400 line-through' : 'text-warm-700';
          return (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className={voidedStyle + ' capitalize'}>{p.method}</span>
              <span className="flex items-center gap-2">
                <span className={'font-mono tabular-nums ' + voidedStyle}>{formatPaise(p.amountPaise)}</span>
                {isSupervisor && !p.isVoid && (
                  <button
                    onClick={() => setPrompt({ paymentId: p.id })}
                    className="text-xs text-status-red hover:text-status-red/80"
                  >
                    Void
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {prompt && (
        <PromptModal
          title="Void payment"
          label="Reason"
          placeholder="Why is this payment being voided?"
          confirmLabel="Void payment"
          busy={voidPayment.isPending}
          onCancel={() => setPrompt(null)}
          onConfirm={async (reason) => {
            setError(null);
            try {
              await voidPayment.mutateAsync({ billId: bill.id, paymentId: prompt.paymentId, reason });
              setPrompt(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'void failed');
            }
          }}
        />
      )}
    </div>
  );
}

function RecordPaymentForm({
  bill,
  orderId,
  outstanding,
}: {
  bill: BillDetail;
  orderId: string;
  outstanding: number;
}) {
  const navigate = useNavigate();
  const record = useRecordPayment(orderId);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState<string>(() => (outstanding / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Stable idempotency key: generated once when the user confirms, reused on
  // retry so a double-tap or network flake doesn't create duplicate payments.
  const idempotencyKeyRef = useRef<string | null>(null);

  function validate(): number | null {
    setError(null);
    const parsed = parseAmountToPaise(amount);
    if (parsed === null) {
      setError('enter a valid amount');
      return null;
    }
    if (parsed <= 0) {
      setError('amount must be greater than zero');
      return null;
    }
    if (parsed > outstanding) {
      setError(`amount exceeds outstanding balance of ${formatPaise(outstanding)}`);
      return null;
    }
    return parsed;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate();
    if (parsed === null) return;
    // Generate a fresh key for each new confirmation dialog
    idempotencyKeyRef.current = crypto.randomUUID();
    setConfirming(true);
  }

  async function onConfirmPayment() {
    const parsed = parseAmountToPaise(amount);
    if (parsed === null || parsed <= 0) return;
    setError(null);
    try {
      const res = await record.mutateAsync({
        billId: bill.id,
        input: {
          idempotencyKey: idempotencyKeyRef.current!,
          method,
          amountPaise: parsed,
          reference: reference.trim() || null,
        },
      });
      setConfirming(false);
      // If the payment closed the bill, auto-navigate to receipt
      if (res.bill.status === 'paid') {
        navigate(`/pos/order/${orderId}/receipt?print=1`);
      }
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : 'payment failed');
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="rounded-lg border border-warm-200 bg-white p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-500">
          Record payment
        </h3>

        <div>
          <label className="text-xs text-warm-600">Method</label>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {(['cash', 'upi', 'card', 'other'] as PaymentMethod[]).map((m) => {
              const selected = m === method;
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMethod(m)}
                  className={
                    'rounded-md px-2 py-1.5 text-xs font-medium capitalize transition ' +
                    (selected
                      ? 'bg-warm-900 text-white'
                      : 'bg-white border border-warm-300 text-warm-700 hover:bg-warm-100')
                  }
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-warm-600">Amount (₹)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-base mt-1 font-mono tabular-nums"
          />
        </label>

        {(method === 'upi' || method === 'card' || method === 'other') && (
          <label className="block">
            <span className="text-xs text-warm-600">Reference (optional)</span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={method === 'upi' ? 'UPI txn id' : method === 'card' ? 'Auth code / last 4' : ''}
              className="input-base mt-1"
            />
          </label>
        )}

        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={record.isPending}
          className="btn-primary w-full"
        >
          {record.isPending ? 'Recording…' : `Record ${formatPaise(parseAmountToPaise(amount) ?? 0)}`}
        </button>
      </form>

      {confirming && (
        <ConfirmPaymentModal
          method={method}
          amountPaise={parseAmountToPaise(amount) ?? 0}
          reference={reference.trim() || null}
          busy={record.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirmPayment}
        />
      )}
    </>
  );
}

function ConfirmPaymentModal({
  method,
  amountPaise,
  reference,
  busy,
  onCancel,
  onConfirm,
}: {
  method: PaymentMethod;
  amountPaise: number;
  reference: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-warm-950/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-white shadow-lg border border-warm-200 p-5 space-y-4"
      >
        <h2 className="text-base font-semibold text-warm-900">Confirm payment</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-warm-500">Method</dt>
            <dd className="font-medium capitalize">{method}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-warm-500">Amount</dt>
            <dd className="font-semibold text-lg font-mono tabular-nums">{formatPaise(amountPaise)}</dd>
          </div>
          {reference && (
            <div className="flex justify-between">
              <dt className="text-warm-500">Reference</dt>
              <dd className="text-warm-700">{reference}</dd>
            </div>
          )}
        </dl>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-md bg-status-green text-white py-2 text-sm font-medium hover:bg-status-green/90 disabled:opacity-60"
          >
            {busy ? 'Recording…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SupervisorActions({
  bill,
  orderId,
  hasPayments,
  settled,
}: {
  bill: BillDetail;
  orderId: string;
  hasPayments: boolean;
  settled: boolean;
}) {
  const [mode, setMode] = useState<'none' | 'discount' | 'void' | 'refund'>('none');

  return (
    <div className="rounded-lg border border-warm-200 bg-white p-4 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-500">
        Supervisor actions
      </h3>

      <button
        onClick={() => setMode('discount')}
        className="btn-secondary w-full"
      >
        {bill.discountPaise > 0 ? 'Edit discount' : 'Apply discount'}
      </button>

      {!settled && !hasPayments && (
        <button
          onClick={() => setMode('void')}
          className="w-full rounded-md border border-status-red/20 bg-white py-1.5 text-sm font-medium text-status-red hover:bg-status-red-light"
        >
          Void bill
        </button>
      )}

      {settled && (
        <button
          onClick={() => setMode('refund')}
          className="w-full rounded-md border border-status-red/20 bg-white py-1.5 text-sm font-medium text-status-red hover:bg-status-red-light"
        >
          Refund bill
        </button>
      )}

      {mode === 'discount' && (
        <DiscountEditor bill={bill} orderId={orderId} onClose={() => setMode('none')} />
      )}
      {mode === 'void' && (
        <VoidBillPrompt bill={bill} orderId={orderId} onClose={() => setMode('none')} />
      )}
      {mode === 'refund' && (
        <RefundPrompt bill={bill} orderId={orderId} onClose={() => setMode('none')} />
      )}
    </div>
  );
}

function DiscountEditor({
  bill,
  orderId,
  onClose,
}: {
  bill: BillDetail;
  orderId: string;
  onClose: () => void;
}) {
  const update = useUpdateBillDiscount(orderId);
  const [type, setType] = useState<'flat' | 'percent'>(bill.discountType ?? 'flat');
  const [value, setValue] = useState<string>(() => {
    if (bill.discountType === 'flat' && bill.discountValue !== null) {
      return (bill.discountValue / 100).toFixed(2);
    }
    if (bill.discountType === 'percent' && bill.discountValue !== null) {
      return (bill.discountValue / 100).toFixed(2); // bps → percent
    }
    return '';
  });
  const [reason, setReason] = useState(bill.discountReason ?? '');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError('reason is required');
      return;
    }
    let discount: DiscountInput;
    if (type === 'flat') {
      const paise = parseAmountToPaise(value);
      if (paise === null || paise <= 0) {
        setError('enter a valid amount');
        return;
      }
      discount = { type: 'flat', valuePaise: paise, reason: reason.trim() };
    } else {
      const pct = Number(value);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setError('enter a percentage between 0 and 100');
        return;
      }
      const bps = Math.round(pct * 100);
      discount = { type: 'percent', valueBps: bps, reason: reason.trim() };
    }
    try {
      await update.mutateAsync({ billId: bill.id, input: { discount } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'update failed');
    }
  }

  async function onClear() {
    setError(null);
    try {
      await update.mutateAsync({ billId: bill.id, input: { discount: null } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'clear failed');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 pt-2 border-t border-warm-100">
      <div className="grid grid-cols-2 gap-1">
        {(['flat', 'percent'] as const).map((t) => {
          const selected = t === type;
          return (
            <button
              type="button"
              key={t}
              onClick={() => setType(t)}
              className={
                'rounded-md px-2 py-1.5 text-xs font-medium capitalize transition ' +
                (selected
                  ? 'bg-warm-900 text-white'
                  : 'bg-white border border-warm-300 text-warm-700 hover:bg-warm-100')
              }
            >
              {t === 'flat' ? 'Flat (₹)' : 'Percent (%)'}
            </button>
          );
        })}
      </div>

      <label className="block">
        <span className="text-xs text-warm-600">{type === 'flat' ? 'Amount (₹)' : 'Percent'}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input-base mt-1 font-mono tabular-nums"
        />
      </label>

      <label className="block">
        <span className="text-xs text-warm-600">Reason</span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          className="input-base mt-1"
        />
      </label>

      {error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-2 py-1 text-xs text-status-red">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost flex-1 text-xs"
        >
          Cancel
        </button>
        {bill.discountPaise > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={update.isPending}
            className="flex-1 rounded-md border border-warm-300 bg-white py-1.5 text-xs font-medium text-status-red hover:bg-status-red-light"
          >
            Remove
          </button>
        )}
        <button
          type="submit"
          disabled={update.isPending}
          className="btn-primary flex-1 text-xs"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function VoidBillPrompt({
  bill,
  orderId,
  onClose,
}: {
  bill: BillDetail;
  orderId: string;
  onClose: () => void;
}) {
  const voidBill = useVoidBill(orderId);
  const [error, setError] = useState<string | null>(null);
  const activePayments = bill.payments.filter((p) => !p.isVoid);
  const hasPayments = activePayments.length > 0;
  return (
    <PromptModal
      title={`Void bill #${bill.billNumber}`}
      label="Reason"
      placeholder="Why is this bill being voided?"
      confirmLabel={hasPayments ? 'Void bill and reverse payments' : 'Void bill'}
      busy={voidBill.isPending}
      error={error}
      warning={
        hasPayments
          ? `This bill has ${activePayments.length} payment(s) totaling ${formatPaise(bill.paidPaise)}. Voiding will also reverse all payments.`
          : undefined
      }
      onCancel={onClose}
      onConfirm={async (reason) => {
        setError(null);
        try {
          await voidBill.mutateAsync({ billId: bill.id, reason });
          onClose();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'void failed');
        }
      }}
    />
  );
}

function RefundPrompt({
  bill,
  orderId,
  onClose,
}: {
  bill: BillDetail;
  orderId: string;
  onClose: () => void;
}) {
  const refund = useRefundBill(orderId);
  const [error, setError] = useState<string | null>(null);
  return (
    <PromptModal
      title={`Refund bill #${bill.billNumber}`}
      label="Reason"
      placeholder="Why is this bill being refunded?"
      confirmLabel="Refund bill"
      busy={refund.isPending}
      error={error}
      onCancel={onClose}
      onConfirm={async (reason) => {
        setError(null);
        try {
          await refund.mutateAsync({ billId: bill.id, reason });
          onClose();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'refund failed');
        }
      }}
    />
  );
}

function PromptModal({
  title,
  label,
  placeholder,
  confirmLabel,
  busy,
  error,
  warning,
  onCancel,
  onConfirm,
}: {
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  busy: boolean;
  error?: string | null;
  warning?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div
      className="fixed inset-0 z-50 bg-warm-950/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length > 0) onConfirm(reason.trim());
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-white shadow-lg border border-warm-200 p-5 space-y-3"
      >
        <h2 className="text-base font-semibold text-warm-900">{title}</h2>
        {warning && (
          <div className="rounded-md bg-status-amber-light border border-status-amber/20 px-3 py-2 text-xs text-status-amber">
            {warning}
          </div>
        )}
        <label className="block">
          <span className="text-xs text-warm-600">{label}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={200}
            placeholder={placeholder}
            className="input-base mt-1"
            autoFocus
          />
        </label>
        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-2 py-1 text-xs text-status-red">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || reason.trim().length === 0}
            className="btn-danger flex-1"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
