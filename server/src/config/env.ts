import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment config loader.
 *
 * Fails loudly at process start if anything required is missing or malformed.
 * We validate at the edge so that no other module in the codebase has to
 * defensively check `process.env.X` — downstream code can trust `env`.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

/**
 * Production sanity checks. The schema validates shape; these validate
 * *intent* — catching the two foot-guns that have historically shipped
 * weak-key deployments:
 *
 *   1. The .env.example placeholder accidentally left in production
 *   2. CORS_ORIGIN left pointing at localhost when the site is on a real
 *      domain — blocks all real traffic and leaves dev traffic wide open
 *
 * We fail hard at boot rather than logging a warning, because a warning in
 * a JSON log on a busy server gets ignored by default and the deployment
 * goes live weak.
 */
if (parsed.data.NODE_ENV === 'production') {
  const errors: string[] = [];
  const weakSecrets = new Set([
    'change-me-to-a-long-random-string',
    'development-secret-do-not-use-in-production',
  ]);
  if (weakSecrets.has(parsed.data.JWT_SECRET)) {
    errors.push('JWT_SECRET is the placeholder from .env.example — generate a real one with: openssl rand -base64 48');
  }
  if (/localhost|127\.0\.0\.1/.test(parsed.data.CORS_ORIGIN)) {
    errors.push(`CORS_ORIGIN points at localhost (${parsed.data.CORS_ORIGIN}) in production — set it to your real web origin`);
  }
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production:\n  - ' + errors.join('\n  - '));
    process.exit(1);
  }
}

export const env = parsed.data;
export type Env = typeof env;
