import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { childLogger } from '../utils/logger.js';
import { isTenantSuspended } from '../utils/tenant-gate.js';
import type { KotWithItems } from '../modules/orders/orders.types.js';
import type { ServiceAlert } from '../modules/alerts/alerts.types.js';

/**
 * KDS WebSocket broadcaster.
 *
 * Design notes:
 *   * One WebSocketServer instance per process, attached to the existing
 *     http.Server via `noServer: true` + manual upgrade handling. This lets
 *     us share the port with the Express app without a reverse proxy.
 *   * Auth: JWT passed as `?token=...` on the upgrade URL. Cookies are not
 *     used (no browser origin required; the KDS runs as an authenticated
 *     app). On verify failure we reject the upgrade with 401.
 *   * Rooms are per-outlet — the kitchen at outlet A must never see KOTs
 *     for outlet B. v1 has one outlet but we still key on it so we don't
 *     have to retrofit.
 *   * Delivery is best-effort. A dropped socket gets garbage-collected on
 *     the next heartbeat; the reconnecting client should refetch active
 *     KOTs via GET /api/v1/kots?active=true on reconnect. The REST endpoint
 *     is the source of truth; WS is a latency-reduction layer.
 *   * We do NOT persist events. If the kitchen tablet goes offline for a
 *     minute, it catches up on reconnect via the REST list.
 */

const log = childLogger('ws/kds');

export type KdsEvent =
  | { type: 'kot.created'; kot: KotWithItems }
  | { type: 'kot.updated'; kot: KotWithItems };

/**
 * Service-alert events ride the same socket as KDS events. The URL is still
 * /ws/kds for backwards compatibility — think of it as "the outlet event
 * bus", not just a kitchen feed. Clients ignore types they don't care about.
 */
export type ServiceAlertEvent =
  | { type: 'alert.created'; alert: ServiceAlert }
  | { type: 'alert.acked'; alert: ServiceAlert };

interface Client {
  socket: WebSocket;
  tenantId: string;
  outletId: string;
  userId: string;
  /** Updated on every pong; sockets with stale isAlive are terminated. */
  isAlive: boolean;
}

let wss: WebSocketServer | null = null;
const clients = new Set<Client>();
let heartbeat: NodeJS.Timeout | null = null;

/** Attach the WebSocket server to an existing http.Server. Idempotent. */
export function attachKdsWebSocket(server: HttpServer): void {
  if (wss) return;

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/kds')) return;

    const token = extractToken(req);
    if (!token) {
      rejectUpgrade(socket, 401, 'missing token');
      return;
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, { clockTolerance: 30 }) as jwt.JwtPayload;
    } catch {
      rejectUpgrade(socket, 401, 'invalid token');
      return;
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.outletId !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      rejectUpgrade(socket, 401, 'malformed token');
      return;
    }

    // Reject suspended tenants at the WS layer too — same in-memory gate
    // that the REST auth middleware uses.
    if (isTenantSuspended(payload.tenantId as string)) {
      rejectUpgrade(socket, 403, 'tenant suspended');
      return;
    }

    // Same gate as the REST KDS endpoints: any authenticated role can read.
    wss!.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = {
        socket: ws,
        tenantId: payload.tenantId as string,
        outletId: payload.outletId as string,
        userId: payload.sub as string,
        isAlive: true,
      };
      clients.add(client);

      ws.on('pong', () => {
        client.isAlive = true;
      });
      ws.on('close', () => {
        clients.delete(client);
      });
      ws.on('error', (err) => {
        log.warn({ err, userId: client.userId }, 'kds socket error');
      });

      ws.send(JSON.stringify({ type: 'hello', outletId: client.outletId }));
      log.info({ userId: client.userId, outletId: client.outletId }, 'kds client connected');
    });
  });

  // Heartbeat: 30s. Clients that don't respond to ping are terminated.
  heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.isAlive) {
        c.socket.terminate();
        clients.delete(c);
        continue;
      }
      c.isAlive = false;
      try {
        c.socket.ping();
      } catch {
        c.socket.terminate();
        clients.delete(c);
      }
    }
  }, 30_000);
  heartbeat.unref?.();
}

/** Broadcast an event to every socket in the matching outlet. Shared path
 *  for KDS and alert events — callers don't touch the client set directly. */
function broadcastToOutlet(outletId: string, payload: string): number {
  let sent = 0;
  for (const c of clients) {
    if (c.outletId !== outletId) continue;
    if (c.socket.readyState !== WebSocket.OPEN) continue;
    try {
      c.socket.send(payload);
      sent++;
    } catch (err) {
      log.warn({ err }, 'outlet socket send failed');
    }
  }
  return sent;
}

/** Broadcast a KOT lifecycle event to every KDS client in the matching outlet. */
export function broadcastKds(event: KdsEvent): void {
  const sent = broadcastToOutlet(event.kot.outletId, JSON.stringify(event));
  if (sent === 0) {
    log.warn({ type: event.type, kotId: event.kot.id }, 'kds broadcast — no connected clients');
  } else {
    log.debug({ type: event.type, kotId: event.kot.id, sent }, 'kds broadcast');
  }
}

/** Broadcast a service alert event to every socket in the outlet — the KDS
 *  tablet AND the mobile phones in the same outlet. Both roles care. */
export function broadcastServiceAlert(event: ServiceAlertEvent): void {
  const sent = broadcastToOutlet(event.alert.outletId, JSON.stringify(event));
  log.debug({ type: event.type, alertId: event.alert.id, sent }, 'alert broadcast');
}

/**
 * Kick all WebSocket clients belonging to a tenant. Called when the platform
 * admin suspends or cancels a tenant. Sends a close frame with code 4001 and
 * reason "tenant suspended" so the client can show an appropriate message
 * rather than silently reconnecting.
 */
export function kickTenant(tenantId: string): void {
  let kicked = 0;
  for (const c of clients) {
    if (c.tenantId !== tenantId) continue;
    try {
      c.socket.close(4001, 'tenant suspended');
    } catch {
      c.socket.terminate();
    }
    clients.delete(c);
    kicked++;
  }
  if (kicked > 0) {
    log.info({ tenantId, kicked }, 'kicked WS clients for suspended tenant');
  }
}

/** Clean shutdown — called from graceful-shutdown path in index.ts. */
export async function closeKdsWebSocket(): Promise<void> {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (!wss) return;
  for (const c of clients) {
    try {
      c.socket.close(1001, 'server shutting down');
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  await new Promise<void>((resolve) => wss!.close(() => resolve()));
  wss = null;
}

// ---- helpers ----------------------------------------------------------------

function extractToken(req: IncomingMessage): string | null {
  // Prefer Authorization header (for non-browser clients), fall back to
  // ?token= query param for browsers that can't set WS headers.
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  if (!req.url) return null;
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

function rejectUpgrade(
  socket: { write: (chunk: string) => void; destroy: () => void },
  code: number,
  reason: string,
): void {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
  socket.destroy();
}
