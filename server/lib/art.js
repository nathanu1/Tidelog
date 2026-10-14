import { hashString } from '../../shared/prng.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Build per-category wave envelopes from bucketed overlap rows.
 * @param {Array<{i:number, category_id:number, minutes:number, weighted:number, entries:number}>} rows
 * @param {Array<{id:number, slug:string, name:string, color:string, sort_order:number}>} categories
 * @param {number} buckets
 * @param {number} bucketMinutes
 */
export function buildLayers(rows, categories, buckets, bucketMinutes) {
  const byCat = new Map();
  for (const r of rows) {
    let layer = byCat.get(r.category_id);
    if (!layer) {
      const cat = categories.find((c) => c.id === r.category_id);
      if (!cat) continue;
      layer = {
        slug: cat.slug,
        name: cat.name,
        color: cat.color,
        sort_order: cat.sort_order,
        env: new Array(buckets).fill(0),
        inten: new Array(buckets).fill(0),
        minutes: 0,
        entries: 0,
      };
      byCat.set(r.category_id, layer);
    }
    const minutes = Number(r.minutes) || 0;
    const weighted = Number(r.weighted) || 0;
    layer.env[r.i] += minutes / bucketMinutes;
    layer.inten[r.i] = minutes ? clamp01(weighted / minutes / 5) : 0;
    layer.minutes += minutes;
    layer.entries = Math.max(layer.entries, Number(r.entries) || 0);
  }
  const layers = [...byCat.values()];
  // Global normalisation keeps the relative size of categories honest.
  let max = 0;
  for (const l of layers) for (const v of l.env) if (v > max) max = v;
  if (max > 0) {
    for (const l of layers) {
      l.env = l.env.map((v) => Number(clamp01(v / max).toFixed(4)));
      l.inten = l.inten.map((v) => Number(v.toFixed(3)));
      l.minutes = Math.round(l.minutes);
    }
  }
  layers.sort((a, b) => a.sort_order - b.sort_order);
  return layers;
}

export function artSeed(rangeKey, stats) {
  return hashString(`${rangeKey}:${stats.latestId || 0}:${stats.count || 0}:${stats.minutes || 0}`);
}
