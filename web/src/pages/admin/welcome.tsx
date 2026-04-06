import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, useAuth } from '../../lib/auth';
import {
  useCategories,
  useCreateCategory,
  useCreateItem,
  useItems,
} from '../../lib/menu';
import { parseAmountToPaise } from '../../lib/money';
import { useBulkCreateTables, useTables, type BulkTableInput } from '../../lib/tables';

/**
 * Onboarding wizard.
 *
 * Shown to a freshly provisioned tenant whose outlet has no categories, items,
 * or tables yet. Three linear steps — category → item → tables — so the owner
 * can punch their first order within a minute of signup. Everything created
 * here is editable later on the regular admin pages; the wizard just exists
 * so an empty outlet isn't a dead end.
 *
 * Entry is gated by `useNeedsOnboarding` (see end of file) and mounted at
 * /admin/welcome from the admin router. Once all three primitives exist the
 * wizard redirects to /admin (items) and normal flow resumes.
 *
 * Not a modal: if the owner closes the tab and comes back, the same empty
 * checks trigger and we land here again. That's intentional — do not set a
 * "dismissed" flag, because the gate IS the empty state.
 */
export function AdminWelcome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useCategories();
  const items = useItems();
  const tables = useTables();

  // Re-compute the "is empty" picture on every render so step checkmarks
  // flip live as the mutations land.
  const hasCategory = (categories.data?.length ?? 0) > 0;
  const hasItem = (items.data?.length ?? 0) > 0;
  const hasTable = (tables.data?.length ?? 0) > 0;
  const allDone = hasCategory && hasItem && hasTable;

  const firstCategoryId = useMemo(
    () => categories.data?.find((c) => c.isActive)?.id ?? null,
    [categories.data],
  );

  // If we already have everything, just bounce. This covers the case where
  // the owner navigated here by hand after completing onboarding elsewhere.
  if (allDone) {
    navigate('/admin', { replace: true });
  }

  const stepLoading = categories.isLoading || items.isLoading || tables.isLoading;
  if (stepLoading) {
    return (
      <div className="p-6 text-sm text-warm-500">Loading your workspace…</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Welcome{user ? `, ${user.fullName}` : ''}</h1>
        <p className="mt-1 text-sm text-warm-600">
          Three quick steps and you can take your first order. You can edit
          everything later from the admin pages.
        </p>
      </header>

      <ol className="space-y-4">
        <StepCard
          index={1}
          title="Add a category"
          hint="Group items together (e.g. Starters, Mains, Drinks)."
          done={hasCategory}
        >
          {!hasCategory && <CategoryStep />}
        </StepCard>

        <StepCard
          index={2}
          title="Add your first item"
          hint="One menu item is enough — add the rest later."
          done={hasItem}
          locked={!hasCategory}
        >
          {hasCategory && !hasItem && firstCategoryId && (
            <ItemStep categoryId={firstCategoryId} />
          )}
        </StepCard>

        <StepCard
          index={3}
          title="Set up tables"
          hint="We'll create them as T1, T2, … — you can rename them later."
          done={hasTable}
        >
          {!hasTable && <TablesStep />}
        </StepCard>
      </ol>

      {allDone && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => navigate('/admin', { replace: true })}
            className="btn-primary"
          >
            Start using the POS
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Step scaffolding ---------------------------------------------

function StepCard({
  index,
  title,
  hint,
  done,
  locked,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  done: boolean;
  locked?: boolean;
  children?: ReactNode;
}) {
  return (
    <li
      className={
        'rounded-lg border p-4 ' +
        (done
          ? 'border-status-green/20 bg-status-green-light'
          : locked
            ? 'border-warm-200 bg-warm-50 opacity-60'
            : 'border-warm-200 bg-white shadow-sm')
      }
    >
      <div className="flex items-start gap-3">
        <StepBadge index={index} done={done} />
        <div className="flex-1">
          <h2 className="text-base font-semibold text-warm-900">{title}</h2>
          <p className="text-xs text-warm-600">{hint}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </li>
  );
}

function StepBadge({ index, done }: { index: number; done: boolean }) {
  if (done) {
    return (
      <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-status-green text-xs font-bold text-white">
        ✓
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-warm-900 text-xs font-bold text-white">
      {index}
    </span>
  );
}

// ---------- Step 1: category --------------------------------------------

function CategoryStep() {
  const create = useCreateCategory();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('name required');
      return;
    }
    try {
      await create.mutateAsync({ name: trimmed });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not create');
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Mains"
        autoFocus
        className="flex-1 input-base text-sm"
      />
      <button
        type="submit"
        disabled={create.isPending}
        className="btn-primary disabled:opacity-60"
      >
        {create.isPending ? 'Adding…' : 'Add'}
      </button>
      {error && (
        <p className="w-full text-xs text-status-red">{error}</p>
      )}
    </form>
  );
}

// ---------- Step 2: item -------------------------------------------------

function ItemStep({ categoryId }: { categoryId: string }) {
  const create = useCreateItem();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('name required');
      return;
    }
    const paise = parseAmountToPaise(price);
    if (paise === null || paise <= 0) {
      setError('enter a price in rupees (e.g. 120 or 99.50)');
      return;
    }
    try {
      await create.mutateAsync({
        categoryId,
        name: trimmed,
        pricePaise: paise,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not create');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Paneer Tikka"
          className="flex-1 input-base text-sm"
        />
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-warm-500">
            ₹
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="120"
            className="w-28 input-base py-2 pl-6 pr-3 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={create.isPending}
          className="btn-primary disabled:opacity-60"
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="text-xs text-status-red">{error}</p>}
    </form>
  );
}

// ---------- Step 3: tables ----------------------------------------------

function TablesStep() {
  const bulk = useBulkCreateTables();
  const [count, setCount] = useState(8);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      setError('pick a number between 1 and 200');
      return;
    }
    const tables: BulkTableInput[] = Array.from({ length: count }, (_, i) => ({
      code: `T${i + 1}`,
      seats: 2,
      displayOrder: i,
    }));
    try {
      await bulk.mutateAsync(tables);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not create tables');
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <label className="text-sm text-warm-700">How many tables?</label>
      <input
        type="number"
        min={1}
        max={200}
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
        className="w-20 input-base text-sm"
      />
      <button
        type="submit"
        disabled={bulk.isPending}
        className="btn-primary disabled:opacity-60"
      >
        {bulk.isPending ? 'Creating…' : 'Create'}
      </button>
      {error && <p className="text-xs text-status-red">{error}</p>}
    </form>
  );
}

// ---------- Gate hook ----------------------------------------------------

/**
 * Returns true when the admin should be redirected to /admin/welcome.
 * Used by AdminHome so that a freshly provisioned tenant lands in the
 * wizard automatically. Returns false while any of the three queries are
 * still loading so we never flash a false-positive redirect.
 */
export function useNeedsOnboarding(): boolean | null {
  const categories = useCategories();
  const items = useItems();
  const tables = useTables();
  if (categories.isLoading || items.isLoading || tables.isLoading) return null;
  if (categories.error || items.error || tables.error) return false;
  const empty =
    (categories.data?.length ?? 0) === 0 &&
    (items.data?.length ?? 0) === 0 &&
    (tables.data?.length ?? 0) === 0;
  return empty;
}
