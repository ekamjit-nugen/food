import { buildApp, markReady, markNotReady } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { pool } from './db/index.js';
import { primeFromDb } from './utils/tenant-gate.js';
import { attachKdsWebSocket, closeKdsWebSocket } from './ws/kds.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

async function main() {
  // Prime the in-memory suspended-tenant gate before accepting traffic.
  // This ensures tenants suspended before a restart are still gated.
  await primeFromDb((sql) => pool.query(sql));

  // Safety check: verify the database role does NOT have BYPASSRLS. If it
  // does, RLS policies are cosmetic and tenant isolation is broken. This is
  // the single most dangerous misconfiguration for a multi-tenant system —
  // fail loud and hard rather than silently leaking data.
  if (env.NODE_ENV !== 'test') {
    const { rows } = await pool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    if (rows[0]?.rolbypassrls) {
      logger.fatal(
        'FATAL: DATABASE_URL role has BYPASSRLS — RLS policies are NOT enforced. ' +
        'Connect as a non-superuser role (e.g. food_app) without BYPASSRLS. See DEPLOY.md.',
      );
      process.exit(1);
    }
  }

  const app = buildApp();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening');
  });

  // KDS WebSocket shares the http server on the /ws/kds path.
  attachKdsWebSocket(server);

  // Signal readiness: /readyz now returns 200 instead of 503.
  markReady();
  logger.info('server ready');

  // --------------------------------------------------------------------------
  // Connection tracking for graceful shutdown.
  //
  // HTTP/1.1 keep-alive connections can hold the server open indefinitely
  // after server.close() (which only stops accepting NEW connections). We
  // track every socket and, during shutdown, destroy idle sockets immediately
  // and set `Connection: close` on in-flight responses so the client doesn't
  // pipeline further requests.
  // --------------------------------------------------------------------------
  const sockets = new Set<Socket>();
  const activeRequests = new Map<Socket, number>();

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    activeRequests.set(socket, 0);
    socket.once('close', () => {
      sockets.delete(socket);
      activeRequests.delete(socket);
    });
  });

  server.on('request', (_req: IncomingMessage, res: ServerResponse) => {
    const socket = res.socket;
    if (!socket) return;
    activeRequests.set(socket, (activeRequests.get(socket) ?? 0) + 1);
    res.once('finish', () => {
      const count = (activeRequests.get(socket) ?? 1) - 1;
      activeRequests.set(socket, count);
      // During shutdown, destroy sockets that have drained all in-flight
      // requests so server.close() can complete.
      if (shuttingDown && count === 0) {
        socket.destroy();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Graceful shutdown
  //
  // Order of operations:
  //   1. Flip /readyz → 503 so the load balancer stops routing new traffic.
  //   2. Close WebSocket connections (KDS clients will reconnect to another
  //      instance or the same one after restart).
  //   3. server.close() — stops accepting new TCP connections.
  //   4. Destroy idle keep-alive sockets immediately. In-flight requests
  //      finish naturally; their `Connection: close` header tells the client
  //      not to reuse the socket.
  //   5. Once all connections drain (or the hard timeout fires), close the
  //      DB pool and exit.
  // --------------------------------------------------------------------------
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // guard against double-signal
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown started');

    // 1. Stop readiness so the LB drains us.
    markNotReady();

    // 2. Close WS connections.
    try {
      await closeKdsWebSocket();
    } catch (wsErr) {
      logger.error({ err: wsErr }, 'error closing kds websocket');
    }

    // 3. Stop accepting new connections.
    server.close(async () => {
      logger.info('all connections drained');
      try {
        await pool.end();
        logger.info('db pool closed');
      } catch (poolErr) {
        logger.error({ err: poolErr }, 'error closing db pool');
      }
      process.exit(0);
    });

    // 4. Destroy idle keep-alive sockets; mark active ones for close-on-drain.
    for (const socket of sockets) {
      const inflight = activeRequests.get(socket) ?? 0;
      if (inflight === 0) {
        socket.destroy();
      } else {
        // The `Connection: close` header is set by the `finish` handler above
        // which destroys the socket once inflight drops to 0.
        socket.end();
      }
    }

    // 5. Hard timeout — if connections don't drain within 10s, force exit.
    setTimeout(() => {
      logger.error(
        { remaining: sockets.size },
        'forcing exit after shutdown timeout',
      );
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
