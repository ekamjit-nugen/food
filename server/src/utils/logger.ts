import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Shared structured logger. One logger per process, child loggers per module.
 *
 * Never log raw request bodies, passwords, or JWTs — redact at source.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.secret',
      '*.deviceToken',
      '*.idempotencyKey',
      // Email is PII — redact from nested objects. Top-level actor_email in
      // audit context is intentional (the audit IS the record of who did what).
      'req.body.email',
      'req.body.tenantSlug',
    ],
    remove: true,
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }
    : {}),
});

export const childLogger = (module: string) => logger.child({ module });
