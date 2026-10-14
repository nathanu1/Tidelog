import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './migrate.js';

async function main() {
  if (config.autoMigrate) await runMigrations();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`LogDataTrack listening on http://localhost:${config.port}  (db: ${config.databaseUrl.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')})`);
    if (config.apiToken) console.log('write endpoints protected by API_TOKEN');
  });
  const shutdown = (sig) => {
    console.log(`\n${sig} received, shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
