import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';
import { childLogger } from '../utils/logger.js';

/**
 * Minimal migration runner.
 *
 * v1 applies a single idempotent schema.sql. When the project grows past a
 * handful of tables, swap this out for a versioned migration tool (node-pg-migrate,
 * sqitch, etc.). Do not prematurely adopt one: a single SQL file is auditable
 * and zero-magic.
 */
const log = childLogger('migrate');

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const schemaPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');

  log.info({ schemaPath }, 'applying schema');
  await pool.query(sql);
  log.info('schema applied successfully');
  await pool.end();
}

main().catch((err) => {
  log.error({ err }, 'migration failed');
  process.exit(1);
});
