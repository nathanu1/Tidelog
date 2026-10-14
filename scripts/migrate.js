#!/usr/bin/env node
import { runMigrations, resetDatabase } from '../server/migrate.js';
import { pool } from '../server/db.js';
import { config } from '../server/config.js';

const reset = process.argv.includes('--reset');
try {
  if (reset) {
    if (config.nodeEnv === 'production' && !process.argv.includes('--force')) {
      throw new Error('refusing to reset a production database without --force');
    }
    console.log('[migrate] dropping schema public ...');
    await resetDatabase();
  }
  await runMigrations();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
