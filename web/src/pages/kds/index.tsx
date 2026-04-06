import { useEffect, useMemo, useState } from 'react';
import { readToken, useAuth, ApiError } from '../../lib/auth';
import {
  useActiveKots,
  useKdsSocket,
  useUpdateKotStatus,
  type KotWithItems,
} from '../../lib/kds';
import type { KotStatus, OrderItem } from '../../lib/orders';

/**
 * KDS — Kitchen Display System.
 *
 * Dark mode, large text, 3-column layout. No sidebar, no shell chrome.
 * Designed for wall-mounted screens viewed from 3+ feet through steam.
 */
export function KdsHome() {
  const token = readToken();
  const { user, logout } = useAuth();
  const isSupervisor = user?.role === 'admin' || user?.role === 'manager';
  const kots = useActiveKots();
  const { connected } = useKdsSocket(token);
  const buckets = useMemo(() => bucketKots(kots.data ?? []), [kots.data]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeCount = (kots.data ?? []).length;

  return (
    <div className="min-h-screen bg-kds-bg text-warm-100 flex flex-col">
      {/* Header — minimal, single row */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-warm-800 bg-warm-950">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-status-green' : 'bg-status-amber animate-pulse'}`} />
            <span className={connected ? 'text-status-green' : 'text-status-amber'}>
              {connected ? 'Live' : 'Reconnecting…'}
            </span>
          </span>
          <span className="text-sm text-warm-400">{activeCount} active</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-warm-400">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button onClick={logout} className="text-xs text-warm-600 hover:text-warm-400 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      {kots.error && (
        <div className="mx-4 mt-3 rounded-md bg-status-red/10 border border-status-red/30 px-3 py-2 text-sm text-status-red">
          {(kots.error as Error).message}
        </div>
      )}

      {/* 3-column board */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-0 md:gap-px bg-warm-800">
        <KdsColumn title="New" count={buckets.new.length} kots={buckets.new} accent="warm" isSupervisor={isSupervisor} bgClass="bg-kds-new" />
        <KdsColumn title="In Progress" count={buckets.in_progress.length} kots={buckets.in_progress} accent="amber" isSupervisor={isSupervisor} bgClass="bg-kds-progress" />
        <KdsColumn title="Ready" count={buckets.ready.length} kots={buckets.ready} accent="green" isSupervisor={isSupervisor} bgClass="bg-kds-ready" />
      </div>
    </div>
  );
}

type Accent = 'warm' | 'amber' | 'green';

function KdsColumn({
  title,
  count,
  kots,
  accent,
  isSupervisor,
  bgClass,
}: {
  title: string;
  count: number;
  kots: KotWithItems[];
  accent: Accent;
  isSupervisor: boolean;
  bgClass: string;
}) {
  const accentColors: Record<Accent, string> = {
    warm: 'text-warm-300 border-warm-600',
    amber: 'text-status-amber border-status-amber/50',
    green: 'text-status-green border-status-green/50',
  };

  return (
    <div className={`${bgClass} flex flex-col min-h-0`}>
      <div className={`sticky top-0 z-10 px-4 py-2.5 border-b ${accentColors[accent]} ${bgClass}`}>
        <span className="text-xs font-semibold uppercase tracking-wider">
          {title} ({count})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {kots.length === 0 ? (
          <p className="text-warm-600 italic text-center py-8 text-sm">No tickets</p>
        ) : (
          kots.map((k) => <KotCard key={k.id} kot={k} accent={accent} isSupervisor={isSupervisor} />)
        )}
      </div>
    </div>
  );
}

function KotCard({ kot, accent, isSupervisor }: { kot: KotWithItems; accent: Accent; isSupervisor: boolean }) {
  const updater = useUpdateKotStatus();
  const elapsed = useElapsed(kot.sentAt);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  const next = nextStatus(kot.status);
  const elapsedSeconds = (Date.now() - new Date(kot.sentAt).getTime()) / 1000;
  const timerColor =
    elapsedSeconds > 600 ? 'text-status-red animate-pulse' :
    elapsedSeconds > 300 ? 'text-status-amber' :
    'text-warm-400';

  const borderColor: Record<Accent, string> = {
    warm: 'border-l-warm-400',
    amber: 'border-l-status-amber',
    green: 'border-l-status-green',
  };

  const actionStyles: Record<Accent, string> = {
    warm: 'bg-warm-800 text-warm-200 hover:bg-warm-700',
    amber: 'bg-status-amber/20 text-status-amber hover:bg-status-amber/30',
    green: 'bg-status-green/20 text-status-green hover:bg-status-green/30',
  };

  const actionLabels: Record<Accent, string> = {
    warm: 'Start →',
    amber: 'Ready ✓',
    green: 'Served ✓',
  };

  async function onVoid() {
    if (!voidReason.trim()) { setVoidError('reason is required'); return; }
    setVoidError(null);
    try {
      await updater.mutateAsync({ kotId: kot.id, status: 'void', reason: voidReason.trim() });
      setShowVoid(false);
    } catch (err) {
      setVoidError(err instanceof ApiError ? err.message : 'void failed');
    }
  }

  return (
    <div className={`rounded-md border border-warm-800 border-l-[3px] ${borderColor[accent]} p-4`}>
      {/* Card header */}
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <span className="text-lg font-semibold text-warm-100">KOT #{kot.kotNumber}</span>
          <div className="text-sm text-warm-400 mt-0.5">
            {kot.order.tableCode ? `${kot.order.tableCode} · ` : ''}
            Order #{kot.order.orderNumber}
            {kot.order.orderType === 'takeaway' && (
              <span className="ml-1.5 badge-violet text-[10px]">TAKEAWAY</span>
            )}
          </div>
        </div>
        <span className={`font-mono text-sm ${timerColor}`}>⏱ {elapsed}</span>
      </div>

      {/* Items — large text for distance reading */}
      <ul className="space-y-1.5 mb-4">
        {kot.items.filter((i) => !i.isVoid).map((i) => (
          <KdsItemLine key={i.id} item={i} />
        ))}
      </ul>

      {/* Action button */}
      {next && (
        <button
          disabled={updater.isPending}
          onClick={() => updater.mutate({ kotId: kot.id, status: next.status })}
          className={`w-full h-11 rounded-sm font-medium transition-all active:scale-[0.97] disabled:opacity-50 ${actionStyles[accent]}`}
        >
          {actionLabels[accent]}
        </button>
      )}

      {/* Void (supervisor only) */}
      {isSupervisor && !showVoid && (
        <button
          onClick={() => setShowVoid(true)}
          className="mt-2 text-xs text-status-red/60 hover:text-status-red transition-colors"
        >
          Void
        </button>
      )}

      {showVoid && (
        <div className="mt-3 border-t border-warm-800 pt-3 space-y-2">
          <textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="Reason for voiding..."
            autoFocus
            className="w-full rounded-sm bg-warm-800 border border-warm-700 text-warm-100 placeholder:text-warm-600 px-3 py-2 text-sm focus:border-status-red focus:ring-1 focus:ring-status-red/30"
          />
          {voidError && <p className="text-xs text-status-red">{voidError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowVoid(false); setVoidReason(''); setVoidError(null); }}
              className="flex-1 h-9 rounded-sm bg-warm-800 text-warm-300 text-xs font-medium hover:bg-warm-700"
            >
              Cancel
            </button>
            <button
              onClick={onVoid}
              disabled={updater.isPending || !voidReason.trim()}
              className="flex-1 h-9 rounded-sm bg-status-red text-white text-xs font-medium hover:bg-status-red/90 disabled:opacity-50"
            >
              {updater.isPending ? 'Voiding…' : 'Confirm void'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KdsItemLine({ item }: { item: OrderItem }) {
  return (
    <li>
      <div className="text-lg text-warm-100">
        <span className="font-bold font-mono">{item.quantity}×</span>{' '}
        <span>{item.menuItemName}</span>
      </div>
      {item.variationName && (
        <div className="text-sm text-warm-400 ml-8">({item.variationName})</div>
      )}
      {item.addons.length > 0 && (
        <div className="text-sm text-warm-400 ml-8">
          +{item.addons.map((a) => a.name).join(', ')}
        </div>
      )}
      {item.notes && (
        <div className="text-sm italic text-status-amber ml-8">{item.notes}</div>
      )}
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

interface Buckets { new: KotWithItems[]; in_progress: KotWithItems[]; ready: KotWithItems[] }

function bucketKots(kots: KotWithItems[]): Buckets {
  const out: Buckets = { new: [], in_progress: [], ready: [] };
  for (const k of kots) {
    if (k.status === 'new') out.new.push(k);
    else if (k.status === 'in_progress') out.in_progress.push(k);
    else if (k.status === 'ready') out.ready.push(k);
  }
  const byTime = (a: KotWithItems, b: KotWithItems) =>
    new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
  out.new.sort(byTime);
  out.in_progress.sort(byTime);
  out.ready.sort(byTime);
  return out;
}

function nextStatus(s: KotStatus): { status: KotStatus; label: string } | null {
  switch (s) {
    case 'new': return { status: 'in_progress', label: 'Start' };
    case 'in_progress': return { status: 'ready', label: 'Ready' };
    case 'ready': return { status: 'served', label: 'Served' };
    default: return null;
  }
}

function useElapsed(sentAt: string): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Date.now() - new Date(sentAt).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
