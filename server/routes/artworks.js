import { Router } from 'express';
import { query } from '../db.js';
import { broadcast } from '../events.js';
import { HttpError, bad, str, int } from '../lib/validate.js';

export const artworks = Router();

artworks.get('/', async (req, res) => {
  const limit = int(req.query.limit, { field: 'limit', min: 1, max: 200, def: 60 });
  const { rows } = await query(
    `SELECT id, title, seed, range_key, thumbnail, created_at,
            params->'totals' AS totals, jsonb_array_length(COALESCE(params->'layers', '[]'::jsonb)) AS layer_count
     FROM artworks ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  res.json({ artworks: rows });
});

artworks.get('/:id', async (req, res) => {
  const id = int(req.params.id, { field: 'id', min: 1 });
  const { rows } = await query('SELECT id, title, seed, range_key, params, thumbnail, created_at FROM artworks WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'artwork not found');
  res.json(rows[0]);
});

artworks.post('/', async (req, res) => {
  const body = req.body || {};
  const title = str(body.title, { field: 'title', max: 120 }) || `Untitled · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const seed = int(body.seed, { field: 'seed', min: 0, max: Number.MAX_SAFE_INTEGER, def: 0 });
  const rangeKey = str(body.range, { field: 'range', max: 8 }) || '24h';
  if (!body.params || typeof body.params !== 'object' || !Array.isArray(body.params.layers)) throw bad('params.layers is required');
  const json = JSON.stringify(body.params);
  if (json.length > 300_000) throw bad('params too large');
  let thumbnail = null;
  if (body.thumbnail !== undefined && body.thumbnail !== null) {
    if (typeof body.thumbnail !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.thumbnail)) throw bad('thumbnail must be a base64 image data URL');
    if (body.thumbnail.length > 900_000) throw bad('thumbnail too large (max ~650KB)');
    thumbnail = body.thumbnail;
  }
  const { rows } = await query(
    `INSERT INTO artworks (title, seed, range_key, params, thumbnail) VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, title, seed, range_key, thumbnail, created_at`,
    [title, seed, rangeKey, json, thumbnail],
  );
  broadcast('artwork.created', { id: rows[0].id, title: rows[0].title });
  res.status(201).json(rows[0]);
});

artworks.patch('/:id', async (req, res) => {
  const id = int(req.params.id, { field: 'id', min: 1 });
  const title = str(req.body?.title, { field: 'title', max: 120, required: true });
  const { rows } = await query('UPDATE artworks SET title = $2 WHERE id = $1 RETURNING id, title, seed, range_key, created_at', [id, title]);
  if (!rows.length) throw new HttpError(404, 'artwork not found');
  res.json(rows[0]);
});

artworks.delete('/:id', async (req, res) => {
  const id = int(req.params.id, { field: 'id', min: 1 });
  const { rowCount } = await query('DELETE FROM artworks WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'artwork not found');
  broadcast('artwork.deleted', { id });
  res.status(204).end();
});
