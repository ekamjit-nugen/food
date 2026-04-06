/**
 * CLI: create a platform super-admin.
 *
 *   npm run platform:create-admin -- --email you@example.com --name "Ops"
 *
 * If --password is omitted a 24-char random password is generated and
 * printed once to stdout. That's the only time it's visible — copy it
 * into your password manager immediately.
 *
 * This script is the ONLY path that creates platform_users rows. There is
 * no HTTP endpoint for self-serve platform admin creation and there should
 * never be one. Privilege to create platform admins == shell access to
 * the database host, which is exactly the boundary we want.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { logger } from '../utils/logger.js';
import { createPlatformAdmin } from '../modules/platform/platform.service.js';
import { pool } from '../db/index.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
    },
    strict: true,
  });

  const email = values.email?.trim().toLowerCase();
  const fullName = values.name?.trim();
  if (!email || !fullName) {
    // eslint-disable-next-line no-console
    console.error('usage: create-platform-admin --email <email> --name <full name> [--password <password>]');
    process.exit(2);
  }

  // 24 base64url chars ≈ 144 bits of entropy. Strong enough as a
  // one-time bootstrap password that the admin will immediately rotate.
  const generated = !values.password;
  const password = values.password ?? randomBytes(18).toString('base64url');

  try {
    const user = await createPlatformAdmin({ email, password, fullName });
    // eslint-disable-next-line no-console
    console.log('\n==========================================================');
    // eslint-disable-next-line no-console
    console.log('PLATFORM ADMIN CREATED');
    // eslint-disable-next-line no-console
    console.log('==========================================================');
    // eslint-disable-next-line no-console
    console.log(`Email:    ${user.email}`);
    // eslint-disable-next-line no-console
    console.log(`Name:     ${user.fullName}`);
    // eslint-disable-next-line no-console
    console.log(`ID:       ${user.id}`);
    if (generated) {
      // eslint-disable-next-line no-console
      console.log(`Password: ${password}`);
      // eslint-disable-next-line no-console
      console.log('(save this now — it will not be shown again)');
    }
    // eslint-disable-next-line no-console
    console.log('==========================================================\n');
  } catch (err) {
    logger.error({ err }, 'failed to create platform admin');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
