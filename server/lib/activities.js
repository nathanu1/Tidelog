import { query } from '../db.js';
import { broadcast } from '../events.js';
import { listCategories } from './categories.js';
import { HttpError, bad, str, int, tags as parseTags, timestamp } from './validate.js';
import { parseQuick, inferCategory } from '../../shared/quickparse.js';

export const ACTIVITY_SELECT = `
  SELECT a.id, a.title, a.note, a.duration_min, a.intensity, a.mood, a.tags, a.source,
         a.started_at, a.created_at, a.updated_at,
         c.slug AS category, c.name AS category_name, c.color AS category_color
  FROM activities a
  JOIN categories c ON c.id = a.category_id`;

export async function getActivity(id) {
  const { rows } = await query(`${ACTIVITY_SELECT} WHERE a.id = $1`, [id]);
  return rows[0] || null;
}

/** Validate a client payload into a normalised activity. `partial` allows missing fields (PATCH). */
export async function normaliseActivity(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') throw bad('body must be a JSON object');
  const categories = await listCategories();
  const out = {};

  let quick = null;
  if (typeof body.text === 'string' && body.text.trim()) quick = parseQuick(body.text, categories);

  const title = str(body.title ?? quick?.title, { field: 'title', max: 200, required: !partial });
  if (title !== null) out.title = title;
  else if (!partial) throw bad('title is required');

  const inferred = !partial && !body.category && !quick?.category && title ? inferCategory(title, categories) : null;
  const catSlug = str(body.category ?? quick?.category ?? inferred ?? (partial ? undefined : 'other'), { field: 'category', max: 40 });
  if (catSlug !== null) {
    const cat = categories.find((c) => c.slug === catSlug.toLowerCase() || c.name.toLowerCase() === catSlug.toLowerCase());
    if (!cat) throw bad(`unknown category "${catSlug}"`, { known: categories.map((c) => c.slug) });
    out.category_id = cat.id;
  }

  const duration = int(body.duration_min ?? quick?.duration_min, { field: 'duration_min', min: 0, max: 1440, def: partial ? undefined : 15 });
  if (duration !== null && duration !== undefined) out.duration_min = duration;

  const intensity = int(body.intensity ?? quick?.intensity, { field: 'intensity', min: 1, max: 5, def: partial ? undefined : 3 });
  if (intensity !== null && intensity !== undefined) out.intensity = intensity;

  if (body.mood !== undefined || quick?.mood != null) {
    out.mood = body.mood === null ? null : int(body.mood ?? quick?.mood, { field: 'mood', min: 1, max: 5 });
  }

  if (body.tags !== undefined || quick) {
    const merged = [...(quick?.tags || []), ...(Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(/[,\s]+/) : [])];
    out.tags = parseTags(merged);
  }

  if (body.note !== undefined) out.note = body.note === null ? null : str(body.note, { field: 'note', max: 2000 });
  if (body.source !== undefined) out.source = str(body.source, { field: 'source', max: 30 }) || 'api';

  const started = timestamp(body.started_at, { field: 'started_at' });
  if (started) out.started_at = started;
  else if (!partial) {
    // Default semantics: "I just finished this" → it started duration minutes ago.
    out.started_at = new Date(Date.now() - (out.duration_min || 0) * 60_000);
  }
  return out;
}

export async function createActivity(data, { source = 'web' } = {}) {
  const { rows } = await query(
    `INSERT INTO activities (category_id, title, note, duration_min, intensity, mood, tags, source, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [data.category_id, data.title, data.note ?? null, data.duration_min, data.intensity, data.mood ?? null, data.tags || [], data.source || source, data.started_at],
  );
  const row = await getActivity(rows[0].id);
  broadcast('activity.created', row);
  return row;
}

export async function updateActivity(id, data) {
  const fields = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    params.push(v);
    fields.push(`${k} = $${params.length}`);
  }
  if (!fields.length) throw bad('nothing to update');
  params.push(id);
  const { rowCount } = await query(`UPDATE activities SET ${fields.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  if (!rowCount) throw new HttpError(404, 'activity not found');
  const row = await getActivity(id);
  broadcast('activity.updated', row);
  return row;
}

export async function deleteActivity(id) {
  const { rowCount } = await query('DELETE FROM activities WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'activity not found');
  broadcast('activity.deleted', { id });
}
