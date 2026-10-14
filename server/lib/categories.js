import { query } from '../db.js';

let cache = null;
let cacheAt = 0;

export async function listCategories({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < 10_000) return cache;
  const { rows } = await query('SELECT id, slug, name, color, sort_order FROM categories ORDER BY sort_order, id');
  cache = rows;
  cacheAt = Date.now();
  return rows;
}

export function invalidateCategories() {
  cache = null;
}

export function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'category';
}
