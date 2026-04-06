/**
 * Vitest global setup. Runs once, BEFORE any test module is imported, so
 * env-dependent modules (config/env.ts) see these values.
 *
 * Do not put test secrets anywhere other than here and the environment.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-at-least-32-characters-long';
// If TEST_DATABASE_URL is set, point the pool at that real database so the
// E2E smoke test can run. Otherwise fall back to a non-routable URL — unit
// tests never actually issue a query so the pool never connects.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/noop';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'fatal';
