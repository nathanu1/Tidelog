import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency). Values already in the environment win.
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://logtrack:logtrack@localhost:5432/logtrack',
  pgSsl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
  port: Number(process.env.PORT || 3000),
  apiToken: process.env.API_TOKEN || '',
  autoMigrate: bool(process.env.AUTO_MIGRATE, true),
  nodeEnv: process.env.NODE_ENV || 'development',
};
