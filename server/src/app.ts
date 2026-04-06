import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { pool } from './db/index.js';
import { logger } from './utils/logger.js';
import { requestContext } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { menuRouter } from './modules/menu/menu.routes.js';
import { tablesRouter } from './modules/tables/tables.routes.js';
import { ordersRouter, kotsRouter } from './modules/orders/orders.routes.js';
import {
  billingOrdersRouter,
  billsRouter,
} from './modules/billing/billing.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { platformRouter } from './modules/platform/platform.routes.js';
import {
  devicesAuthRouter,
  devicesAdminRouter,
} from './modules/devices/devices.routes.js';
import { alertsRouter } from './modules/alerts/alerts.routes.js';
import {
  billsPdfRouter,
  kotsPdfRouter,
} from './modules/pdf/pdf.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { outletsRouter } from './modules/outlets/outlets.routes.js';

let _ready = false;

/**
 * Mark the server as ready. Called from index.ts after startup tasks
 * (primeFromDb, etc.) complete. Before this call, /readyz returns 503.
 */
export function markReady(): void {
  _ready = true;
}

/**
 * Flip readiness off. Called at the start of graceful shutdown so the
 * load balancer stops routing new traffic before we close the listener.
 */
export function markNotReady(): void {
  _ready = false;
}

/**
 * Build the Express app. Exported as a factory so tests can spin up an
 * isolated instance without the .listen() side effect.
 */
export function buildApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(requestContext);

  // CORS — deliberately restrictive. No wildcard in production.
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && origin === env.CORS_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id, X-Outlet-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // ---- health probes --------------------------------------------------------
  // /healthz  — liveness. Process is alive and can serve HTTP. No external
  //             dependency check — if the event loop is running, this returns
  //             200. A load balancer uses this to detect hung processes.
  // /readyz   — readiness. The server has completed startup (DB connected,
  //             tenant gate primed) and is capable of serving real traffic.
  //             Returns 503 until markReady() is called (from index.ts after
  //             primeFromDb completes). Also runs a lightweight DB probe
  //             (`SELECT 1`) on each call so a broken DB connection pool
  //             flips the readiness probe without restarting the process.

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/readyz', async (_req, res) => {
    if (!_ready) {
      res.status(503).json({ status: 'not_ready', reason: 'startup_pending' });
      return;
    }
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (err) {
      logger.warn({ err }, 'readyz: DB probe failed');
      res.status(503).json({ status: 'not_ready', reason: 'db_unreachable' });
    }
  });

  app.use('/api/v1/auth', authRouter);
  // Device pairing lives on /auth because the anonymous /pair and
  // /device-login endpoints belong in the auth namespace conceptually.
  app.use('/api/v1/auth', devicesAuthRouter);
  app.use('/api/v1/platform', platformRouter);
  app.use('/api/v1/users', usersRouter);
  // Second router on the same prefix — handles the device sub-resources
  // on users (:id/pairing-codes, :id/devices[/deviceId]).
  app.use('/api/v1/users', devicesAdminRouter);
  app.use('/api/v1/menu', menuRouter);
  app.use('/api/v1/tables', tablesRouter);
  app.use('/api/v1/orders', ordersRouter);
  // billingOrdersRouter adds /:id/bill (generate + get) under the same mount.
  app.use('/api/v1/orders', billingOrdersRouter);
  app.use('/api/v1/kots', kotsRouter);
  app.use('/api/v1/bills', billsRouter);
  // Second billsRouter mount for the /:id/pdf reprint endpoint. Kept in
  // its own file so billing tests don't pull in pdfkit.
  app.use('/api/v1/bills', billsPdfRouter);
  app.use('/api/v1/kots', kotsPdfRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/alerts', alertsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/outlets', outletsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
