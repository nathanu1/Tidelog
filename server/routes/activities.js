import { Router } from 'express';
import { query } from '../db.js';
import { ACTIVITY_SELECT, normaliseActivity, createActivity, updateActivity, deleteActivity, getActivity } from '../lib/activities.js';
import { HttpError, bad, int, timestamp } from '../lib/validate.js';
import { listCategories } from '../lib/categories.js';
import { parseQuick } from '../../shared/quickparse.js';

export const activities = Router();

activities.get('/', async (req, res) => {
  const limit = int(req.query.limit, { field: 'limit', min: 1, max: 500, def: 50 });
  const offset = int(req.query.offset, { field: 'offset', min: 0, max: 1_000_000, def: 0 });
  const from = timestamp(req.query.from, { field: 'from' });
  const to = timestamp(req.query.to, { field: 'to' });
  const where = [];
  const params = [];
  if (from) { params.push(from); where.push(`a.started_at >= $${params.length}`); }
  if (to) { params.push(to); where.push(`a.started_at < $${params.length}`); }
  if (typeof req.query.category === 'string' && req.query.category) { params.push(req.query.category); where.push(`c.slug = $${params.length}`); }
  if (typeof req.query.tag === 'string' && req.query.tag) { params.push(req.query.tag.toLowerCase()); where.push(`$${params.length} = ANY(a.tags)`); }
  if (typeof req.query.q === 'string' && req.query.q.trim()) { params.push(`%${req.query.q.trim()}%`); where.push(`(a.title ILIKE $${params.length} OR a.note ILIKE $${params.length})`); }
  params.push(limit, offset);
  const sql = `${ACTIVITY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.started_at DESC, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const { rows } = await query(sql, params);
  res.json({ activities: rows, limit, offset });
});

/** Preview what the quick parser would do with a line, without saving. */
activities.get('/parse', async (req, res) => {
  const text = typeof req.query.text === 'string' ? req.query.text : '';
  res.json(parseQuick(text, await listCategories()));
});

activities.post('/', async (req, res) => {
  const data = await normaliseActivity(req.body);
  const row = await createActivity(data, { source: req.body.source || 'api' });
  res.status(201).json(row);
});

/** One-liner logging for CLIs, shortcuts and webhooks: { "text": "45m deep work @work #focus !4" } */
activities.post('/quick', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) throw bad('text is required');
  const data = await normaliseActivity({ ...req.body, text });
  if (!data.title) throw bad('could not find a title in the text');
  const row = await createActivity(data, { source: req.body.source || 'quick' });
  res.status(201).json(row);
});

activities.get('/:id', async (req, res) => {
  const id = int(req.params.id, { field: 'id', min: 1 });
  const row = await getActivity(id);
  if (!row) throw new HttpError(404, 'activity not found');
  res.json(row);
});

activities.patch('/:id', async (req, res) => {
  const id = int(req.params.id, { field: 'id', min: 1 });
  const data = await normaliseActivity(req.body, { partial: true });
  res.json(await updateActivity(id, data));
});

activities.delete('/:id', async (req, res) => {
  const id = int(req.params.id, { field: 'id', min: 1 });
  await deleteActivity(id);
  res.status(204).end();
});
