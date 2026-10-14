import { Router } from 'express';
import { query } from '../db.js';
import { listCategories, invalidateCategories, slugify } from '../lib/categories.js';
import { broadcast } from '../events.js';
import { HttpError, bad, str, int } from '../lib/validate.js';

export const categories = Router();

const HEX = /^#[0-9a-f]{6}$/i;

categories.get('/', async (req, res) => {
  res.json({ categories: await listCategories({ fresh: true }) });
});

categories.post('/', async (req, res) => {
  const name = str(req.body?.name, { field: 'name', max: 40, required: true });
  const slug = str(req.body?.slug, { field: 'slug', max: 40 }) || slugify(name);
  const color = str(req.body?.color, { field: 'color', max: 7 }) || '#9A948F';
  if (!HEX.test(color)) throw bad('color must be a hex colour like #3B7BE0');
  const sort = int(req.body?.sort_order, { field: 'sort_order', min: 0, max: 10_000, def: 100 });
  const { rows } = await query(
    `INSERT INTO categories (slug, name, color, sort_order) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order
     RETURNING id, slug, name, color, sort_order`,
    [slug.toLowerCase(), name, color.toUpperCase(), sort],
  );
  invalidateCategories();
  broadcast('categories.changed', rows[0]);
  res.status(201).json(rows[0]);
});

categories.patch('/:slug', async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  const name = str(req.body?.name, { field: 'name', max: 40 });
  const color = str(req.body?.color, { field: 'color', max: 7 });
  if (color && !HEX.test(color)) throw bad('color must be a hex colour like #3B7BE0');
  const sort = int(req.body?.sort_order, { field: 'sort_order', min: 0, max: 10_000 });
  const { rows } = await query(
    `UPDATE categories SET name = COALESCE($2, name), color = COALESCE($3, color), sort_order = COALESCE($4, sort_order)
     WHERE slug = $1 RETURNING id, slug, name, color, sort_order`,
    [slug, name, color ? color.toUpperCase() : null, sort],
  );
  if (!rows.length) throw new HttpError(404, 'category not found');
  invalidateCategories();
  broadcast('categories.changed', rows[0]);
  res.json(rows[0]);
});

categories.delete('/:slug', async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  const { rows } = await query(
    `SELECT c.id, (SELECT count(*) FROM activities a WHERE a.category_id = c.id) AS used FROM categories c WHERE c.slug = $1`,
    [slug],
  );
  if (!rows.length) throw new HttpError(404, 'category not found');
  if (rows[0].used > 0) throw new HttpError(409, `category has ${rows[0].used} activities; move them first`);
  await query('DELETE FROM categories WHERE id = $1', [rows[0].id]);
  invalidateCategories();
  broadcast('categories.changed', { slug, deleted: true });
  res.status(204).end();
});
