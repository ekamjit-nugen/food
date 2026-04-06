import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import {
  useSettings,
  useUpdateBusiness,
  useUpdateTax,
  useUpdateBilling,
  useUpdateOperations,
  INDIAN_STATES,
  type OutletSettings,
} from '../../lib/settings';

export function AdminSettings() {
  const { data: settings, isLoading, error } = useSettings();

  if (isLoading) return <p className="text-sm text-warm-500">Loading settings...</p>;
  if (error) return <p className="text-sm text-status-red">Failed to load settings.</p>;
  if (!settings) return null;

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold">Settings</h2>
      <BusinessSection settings={settings} />
      <hr className="border-warm-200" />
      <TaxSection settings={settings} />
      <hr className="border-warm-200" />
      <BillingSection settings={settings} />
      <hr className="border-warm-200" />
      <OperationsSection settings={settings} />
    </div>
  );
}

// ── Business Info ──────────────────────────────────────────────────────

function BusinessSection({ settings }: { settings: OutletSettings }) {
  const mutation = useUpdateBusiness();
  const [name, setName] = useState(settings.name);
  const [line1, setLine1] = useState(settings.addressLine1 ?? '');
  const [line2, setLine2] = useState(settings.addressLine2 ?? '');
  const [city, setCity] = useState(settings.city ?? '');
  const [state, setState] = useState(settings.state ?? '');
  const [pincode, setPincode] = useState(settings.pincode ?? '');
  const [phone, setPhone] = useState(settings.phone ?? '');
  const [email, setEmail] = useState(settings.email ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    mutation.mutate(
      {
        name: name.trim(),
        addressLine1: line1.trim() || null,
        addressLine2: line2.trim() || null,
        city: city.trim() || null,
        state: state || null,
        pincode: pincode.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      },
      {
        onSuccess: () => setMsg({ ok: true, text: 'Settings saved' }),
        onError: (err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Save failed' }),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-warm-800">Business details</h3>
        <p className="text-xs text-warm-500">This information appears on receipts and tax invoices.</p>
      </div>
      <Field label="Restaurant name">
        <input required value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
      </Field>
      <Field label="Address line 1">
        <input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="123 Main Street" className={INPUT} />
      </Field>
      <Field label="Address line 2">
        <input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Floor 2, Near Park" className={INPUT} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="City">
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" className={INPUT} />
        </Field>
        <Field label="State">
          <select value={state} onChange={(e) => setState(e.target.value)} className={INPUT}>
            <option value="">Select state</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="PIN code">
          <input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="400001" pattern="[1-9][0-9]{5}" className={INPUT} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className={INPUT} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@restaurant.com" className={INPUT} />
        </Field>
      </div>
      <SaveButton busy={mutation.isPending} msg={msg} label="Save business details" />
    </form>
  );
}

// ── Tax & Compliance ───────────────────────────────────────────────────

function TaxSection({ settings }: { settings: OutletSettings }) {
  const mutation = useUpdateTax();
  const [gstin, setGstin] = useState(settings.gstin ?? '');
  const [fssai, setFssai] = useState(settings.fssaiNo ?? '');
  const [taxRate, setTaxRate] = useState(String(settings.defaultTaxRateBps / 100));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    mutation.mutate(
      {
        gstin: gstin.trim().toUpperCase() || null,
        fssaiLicense: fssai.trim() || null,
        defaultTaxRateBps: Math.round(parseFloat(taxRate) * 100),
      },
      {
        onSuccess: () => setMsg({ ok: true, text: 'Settings saved' }),
        onError: (err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Save failed' }),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-warm-800">Tax & compliance</h3>
        <p className="text-xs text-warm-500">GST registration and food safety license details.</p>
      </div>
      <Field label="GSTIN">
        <input
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          placeholder="22AAAAA0000A1Z5"
          maxLength={15}
          className={INPUT}
        />
      </Field>
      <Field label="FSSAI license">
        <input
          value={fssai}
          onChange={(e) => setFssai(e.target.value)}
          placeholder="10012345000123"
          maxLength={14}
          className={INPUT}
        />
      </Field>
      <Field label="Default tax rate (%)">
        <input
          type="number"
          required
          min={0}
          max={28}
          step={0.01}
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-warm-500">
          Applied to new menu items. Common rates: 5% (non-AC), 18% (AC), 28% (5-star).
        </p>
      </Field>
      <SaveButton busy={mutation.isPending} msg={msg} label="Save tax settings" />
    </form>
  );
}

// ── Billing ────────────────────────────────────────────────────────────

function BillingSection({ settings }: { settings: OutletSettings }) {
  const mutation = useUpdateBilling();
  const [prefix, setPrefix] = useState(settings.billNumberPrefix ?? '');
  const [footer, setFooter] = useState(settings.receiptFooterText);
  const [maxDiscount, setMaxDiscount] = useState(
    settings.maxDiscountBps != null ? String(settings.maxDiscountBps / 100) : '',
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    mutation.mutate(
      {
        billNumberPrefix: prefix.trim() || null,
        receiptFooterText: footer.trim() || null,
        maxDiscountBps: maxDiscount ? Math.round(parseFloat(maxDiscount) * 100) : null,
      },
      {
        onSuccess: () => setMsg({ ok: true, text: 'Settings saved' }),
        onError: (err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Save failed' }),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-warm-800">Billing & receipts</h3>
        <p className="text-xs text-warm-500">Customize how bills and receipts look.</p>
      </div>
      <Field label="Bill number prefix">
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="INV" maxLength={10} className={INPUT} />
        <p className="mt-1 text-xs text-warm-500">Bills numbered as {prefix || 'INV'}/001, {prefix || 'INV'}/002, etc.</p>
      </Field>
      <Field label="Receipt footer text">
        <input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Thank you for your visit." maxLength={200} className={INPUT} />
      </Field>
      <Field label="Max discount (%)">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={maxDiscount}
          onChange={(e) => setMaxDiscount(e.target.value)}
          placeholder="50"
          className={INPUT}
        />
        <p className="mt-1 text-xs text-warm-500">Maximum discount a manager can apply. Leave empty for no limit.</p>
      </Field>
      <SaveButton busy={mutation.isPending} msg={msg} label="Save billing settings" />
    </form>
  );
}

// ── Operations ─────────────────────────────────────────────────────────

function OperationsSection({ settings }: { settings: OutletSettings }) {
  const mutation = useUpdateOperations();
  const [warning, setWarning] = useState(String(settings.kotWarningMinutes));
  const [urgent, setUrgent] = useState(String(settings.kotUrgentMinutes));
  const [autoRestock, setAutoRestock] = useState(settings.autoRestock);
  const [restockTime, setRestockTime] = useState(settings.autoRestockTime);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    mutation.mutate(
      {
        kotWarningMinutes: parseInt(warning, 10),
        kotUrgentMinutes: parseInt(urgent, 10),
        autoRestock,
        autoRestockTime: restockTime,
      },
      {
        onSuccess: () => setMsg({ ok: true, text: 'Settings saved' }),
        onError: (err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Save failed' }),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-warm-800">Operations</h3>
        <p className="text-xs text-warm-500">Kitchen and service configuration.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="KOT warning time (minutes)">
          <input type="number" required min={1} max={60} value={warning} onChange={(e) => setWarning(e.target.value)} className={INPUT} />
          <p className="mt-1 text-xs text-warm-500">KOT cards turn amber after this many minutes.</p>
        </Field>
        <Field label="KOT urgent time (minutes)">
          <input type="number" required min={1} max={60} value={urgent} onChange={(e) => setUrgent(e.target.value)} className={INPUT} />
          <p className="mt-1 text-xs text-warm-500">KOT cards turn red after this many minutes.</p>
        </Field>
      </div>
      <Field label="">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoRestock} onChange={(e) => setAutoRestock(e.target.checked)} className="rounded" />
          Auto-restock daily
        </label>
        <p className="mt-1 text-xs text-warm-500">Automatically mark all items as 'In stock' every day.</p>
      </Field>
      {autoRestock && (
        <Field label="Auto-restock time">
          <input type="time" value={restockTime} onChange={(e) => setRestockTime(e.target.value)} className={INPUT} />
        </Field>
      )}
      <SaveButton busy={mutation.isPending} msg={msg} label="Save operations settings" />
    </form>
  );
}

// ── Shared components ──────────────────────────────────────────────────

const INPUT = 'mt-1 w-full input-base text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium text-warm-700">{label}</span>}
      {children}
    </label>
  );
}

function SaveButton({
  busy,
  msg,
  label,
}: {
  busy: boolean;
  msg: { ok: boolean; text: string } | null;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={busy}
        className="btn-primary disabled:opacity-60"
      >
        {busy ? 'Saving...' : label}
      </button>
      {msg && (
        <span className={`text-sm ${msg.ok ? 'text-status-green' : 'text-status-red'}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
