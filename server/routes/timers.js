import { Router } from 'express';
import { query } from '../db.js';
import { broadcast } from '../events.js';
import { listCategories } from '../lib/categories.js';
import { createActivity, normaliseActivity } from '../lib/activities.js';
import { HttpError, bad, str, int, tags as parseTags } from '../lib/validate.js';
import { parseQuick } from '../../shared/quickparse.js';

export const timers = Router();

const TIMER_SELECT = `
  SELECT t.id, t.title, t.tags, t.intensity, t.started_at, t.stopped_at, t.activity_id,
         c.slug AS category, c.name AS category_name, c.color AS category_color
  FROM timers t JOIN categories c ON c.id = t.category_id`;

async function activeTimer() {
  const { rows } = await query(`${TIMER_SELECT} WHERE t.stopped_at IS NULL LIMIT 1`);
  return rows[0] || null;
}

timers.get('/active', async (req, res) => {
  res.json({ timer: await activeTimer() });
});

timers.post('/start', async (req, res) => {
  const cats = await listCategories();
  const quick = typeof req.body?.text === 'string' ? parseQuick(req.body.text, cats) : null;
  const title = str(req.body?.title ?? quick?.title, { field: 'title', max: 200, required: true });
  const slug = (str(req.body?.category ?? quick?.category, { field: 'category', max: 40 }) || 'other').toLowerCase();
  const cat = cats.find((c) => c.slug === slug || c.name.toLowerCase() === slug);
  if (!cat) throw bad(`unknown category "${slug}"`);
  const intensity = int(req.body?.intensity ?? quick?.intensity, { field: 'intensity', min: 1, max: 5, def: 3 });
  const tags = parseTags([...(quick?.tags || []), ...(Array.isArray(req.body?.tags) ? req.body.tags : [])]);
  const existing = await activeTimer();
  if (existing) throw new HttpError(409, 'a timer is already running', { timer: existing });
  const { rows } = await query(
    `INSERT INTO timers (category_id, title, tags, intensity) VALUES ($1, $2, $3, $4) RETURNING id`,
    [cat.id, title, tags, intensity],
  );
  const timer = (await query(`${TIMER_SELECT} WHERE t.id = $1`, [rows[0].id])).rows[0];
  broadcast('timer.started', timer);
  res.status(201).json({ timer });
});

timers.post('/stop', async (req, res) => {
  const timer = await activeTimer();
  if (!timer) throw new HttpError(404, 'no timer is running');
  const elapsedMin = Math.max(1, Math.round((Date.now() - new Date(timer.started_at).getTime()) / 60_000));
  const data = await normaliseActivity({
    title: req.body?.title ?? timer.title,
    category: timer.category,
    duration_min: Math.min(1440, elapsedMin),
    intensity: req.body?.intensity ?? timer.intensity,
    mood: req.body?.mood,
    tags: [...timer.tags, ...(Array.isArray(req.body?.tags) ? req.body.tags : [])],
    note: req.body?.note,
    started_at: timer.started_at,
    source: 'timer',
  });
  // Close the timer first so a second concurrent stop cannot log the same session twice.
  const { rowCount } = await query('UPDATE timers SET stopped_at = now() WHERE id = $1 AND stopped_at IS NULL', [timer.id]);
  if (!rowCount) throw new HttpError(409, 'timer was already stopped');
  const activity = await createActivity(data, { source: 'timer' });
  await query('UPDATE timers SET activity_id = $2 WHERE id = $1', [timer.id, activity.id]);
  broadcast('timer.stopped', { id: timer.id, activity });
  res.json({ activity, timer: { ...timer, stopped_at: new Date().toISOString(), activity_id: activity.id } });
});

timers.delete('/active', async (req, res) => {
  const timer = await activeTimer();
  if (!timer) throw new HttpError(404, 'no timer is running');
  await query('UPDATE timers SET stopped_at = now() WHERE id = $1', [timer.id]);
  broadcast('timer.stopped', { id: timer.id, cancelled: true });
  res.status(204).end();
});
