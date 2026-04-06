import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15_000,
    // Integration tests (menu.integration.test.ts, e2e.test.ts) share a
    // single Postgres database. e2e's TRUNCATE ... CASCADE races with the
    // menu test's per-suite fixtures if files run in parallel, causing
    // sporadic FK-violation failures mid-suite. Force sequential file
    // execution so DB-touching suites don't stomp on each other.
    fileParallelism: false,
  },
});
