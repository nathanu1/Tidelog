import express from 'express';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { pool } from './db.js';
import { sseHandler } from './events.js';
import { requireToken } from './middleware/auth.js';
import { HttpError } from './lib/validate.js';
import { activities } from './routes/activities.js';
import { categories } from './routes/categories.js';
import { metrics } from './routes/metrics.js';
import { art } from './routes/art.js';
import { timers } from './routes/timers.js';
import { artworks } from './routes/artworks.js';
import { exporter } from './routes/export.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (req, res) => {
    const { rows } = await pool.query('SELECT now() AS now');
    res.json({ ok: true, now: rows[0].now, version: process.env.npm_package_version || '0.1.0', protected: Boolean(config.apiToken) });
  });

  app.get('/api/events', sseHandler);

  app.use('/api', requireToken);
  app.use('/api/activities', activities);
  app.use('/api/categories', categories);
  app.use('/api/metrics', metrics);
  app.use('/api/art', art);
  app.use('/api/timers', timers);
  app.use('/api/artworks', artworks);
  app.use('/api', exporter);

  app.use('/api', (req, res) => res.status(404).json({ error: `no route for ${req.method} ${req.originalUrl}` }));

  app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: '1h' }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
    if (err?.code === '23505') return res.status(409).json({ error: 'conflict: already exists' });
    if (err?.code === '23514' || err?.code === '22P02') return res.status(400).json({ error: err.message });
    console.error('[error]', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
