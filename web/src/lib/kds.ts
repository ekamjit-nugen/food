import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { readToken } from './auth';
import type { Kot, KotStatus, OrderItem, OrderType } from './orders';

/**
 * KDS hooks.
 *
 * The REST endpoint `GET /kots?active=true` is the source of truth for which
 * KOTs are currently on the board. The WebSocket is a latency layer: on
 * `kot.created` we append, on `kot.updated` we upsert (and drop if the new
 * status is terminal — served or void). Reconnect = refetch the REST list.
 */

export interface KotWithItems extends Kot {
  items: OrderItem[];
  order: {
    id: string;
    orderNumber: number;
    orderType: OrderType;
    tableId: string | null;
    tableCode: string | null;
  };
}

export const kdsKeys = {
  active: ['kds', 'active'] as const,
};

export function useActiveKots() {
  return useQuery({
    queryKey: kdsKeys.active,
    queryFn: async () => {
      const res = await api.get<{ data: KotWithItems[] }>('/kots', { active: true });
      return res.data;
    },
    // Short staleTime — the WS does live updates but if the socket drops we
    // still want occasional refetches to catch up automatically.
    staleTime: 10_000,
  });
}

export function useUpdateKotStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { kotId: string; status: KotStatus; reason?: string }) => {
      const body: { status: KotStatus; reason?: string } = { status: vars.status };
      if (vars.reason !== undefined) body.reason = vars.reason;
      return api.patch<KotWithItems>(`/kots/${vars.kotId}/status`, body);
    },
    onSuccess: (kot) => {
      // Optimistic merge: the WS broadcast will usually arrive first, but we
      // also update the cache directly so the UI feels instant even if the
      // socket is lagging.
      upsertKotInCache(qc, kot);
    },
  });
}

/**
 * Open the KDS WebSocket once on mount and push events into the react-query
 * cache. No custom store: TanStack's cache is the single source of truth.
 *
 * The hook returns a simple connected flag so the UI can surface the
 * "realtime" vs "catching up" state to the kitchen.
 */
export function useKdsSocket(token: string | null): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      // Same-origin WS URL. In dev, Vite proxies /api but NOT /ws — we hit
      // the backend directly. In prod they share an origin behind the reverse
      // proxy and this URL Just Works.
      const currentToken = readToken() ?? token;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host =
        import.meta.env.DEV ? 'localhost:4000' : window.location.host;
      const url = `${proto}//${host}/ws/kds?token=${encodeURIComponent(currentToken!)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        // Refresh the REST list on (re)connect so we catch up on anything
        // that happened while the socket was down.
        qc.invalidateQueries({ queryKey: kdsKeys.active });
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as
            | { type: 'hello'; outletId: string }
            | { type: 'kot.created'; kot: KotWithItems }
            | { type: 'kot.updated'; kot: KotWithItems };
          if (msg.type === 'kot.created' || msg.type === 'kot.updated') {
            upsertKotInCache(qc, msg.kot);
          }
        } catch {
          // Malformed frame — ignore rather than crash the board.
        }
      };

      ws.onclose = (ev) => {
        setConnected(false);
        if (closed) return;
        // Auth-related close codes: try to reconnect with a fresh token
        // (the auto-refresh interceptor in api.ts may have already refreshed it)
        const delay = ev.code === 4001 || ev.code === 1008 ? 1000 : 3000;
        reconnectTimer = setTimeout(() => {
          // Re-read token — it may have been refreshed by the API interceptor
          const freshToken = readToken();
          if (freshToken && freshToken !== token) {
            // Token was refreshed by another request — reconnect will use it
          }
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // Let onclose handle reconnect; error alone doesn't guarantee close.
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [token, qc]);

  return { connected };
}

function upsertKotInCache(qc: ReturnType<typeof useQueryClient>, kot: KotWithItems): void {
  qc.setQueryData<KotWithItems[]>(kdsKeys.active, (prev) => {
    const list = prev ?? [];
    const terminal = kot.status === 'served' || kot.status === 'void';
    const without = list.filter((k) => k.id !== kot.id);
    if (terminal) return without;
    return [...without, kot];
  });
}
