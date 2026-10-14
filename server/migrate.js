import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { pool } from './db.js';

const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

export async function runMigrations({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    // Serialize concurrent boots (e.g. several app replicas) on one advisory lock.
    await client.query('SELECT pg_advisory_lock(727001)');
    try {
      const { rows } = await client.query('SELECT version FROM schema_migrations');
      const applied = new Set(rows.map((r) => r.version));
      const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
      let count = 0;
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`migration ${file} failed: ${err.message}`);
        }
        log(`[migrate] applied ${file}`);
        count++;
      }
      if (count === 0) log('[migrate] up to date');
      return count;
    } finally {
      await client.query('SELECT pg_advisory_unlock(727001)');
    }
  } finally {
    client.release();
  }
}

export async function resetDatabase() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
