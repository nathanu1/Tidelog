import { Router } from 'express';
import { query } from '../db.js';
import { buildLayers, artSeed } from '../lib/art.js';
import { rangeSpec } from '../lib/metrics.js';
import { listCategories } from '../lib/categories.js';

export const art = Router();

/**
 * Wave envelopes for the artwork: for every category, how much of each time slice
 * was filled with activity (overlap-weighted), plus how intense it was.
 */
art.get('/', async (req, res) => {
  const rangeKey = ['24h', '7d', '30d'].includes(req.query.range) ? req.query.range : '24h';
  const spec = rangeSpec(rangeKey);
  const t1 = new Date();
  const t0 = new Date(t1.getTime() - spec.hours * 3_600_000);
  const n = spec.buckets;
  const bucketMinutes = (spec.hours * 60) / n;

  const [{ rows }, { rows: [stats] }, { rows: [pulse] }, cats] = await Promise.all([
    query(
      `WITH p AS (SELECT $1::timestamptz AS t0, $2::timestamptz AS t1, $3::int AS n),
            b AS (SELECT i, t0 + (t1 - t0) * (i::float8 / n) AS b0, t0 + (t1 - t0) * ((i + 1)::float8 / n) AS b1
                  FROM p, generate_series(0, n - 1) AS i)
       SELECT b.i, a.category_id,
              SUM(EXTRACT(EPOCH FROM (LEAST(b.b1, a.started_at + GREATEST(a.duration_min, 2) * interval '1 minute') - GREATEST(b.b0, a.started_at))) / 60.0) AS minutes,
              SUM(EXTRACT(EPOCH FROM (LEAST(b.b1, a.started_at + GREATEST(a.duration_min, 2) * interval '1 minute') - GREATEST(b.b0, a.started_at))) / 60.0 * a.intensity) AS weighted,
              COUNT(*)::int AS entries
       FROM b JOIN activities a
         ON a.started_at < b.b1 AND a.started_at + GREATEST(a.duration_min, 2) * interval '1 minute' > b.b0
       GROUP BY b.i, a.category_id ORDER BY b.i`,
      [t0, t1, n],
    ),
    query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(duration_min), 0)::int AS minutes, COALESCE(MAX(id), 0) AS latest_id
       FROM activities WHERE started_at >= $1 AND started_at <= $2`,
      [t0, t1],
    ),
    query(
      `SELECT COALESCE(SUM(GREATEST(duration_min, 1) * intensity / 5.0), 0)::float8 AS energy_min,
              (SELECT COUNT(*)::int FROM activities WHERE started_at >= now() - interval '24 hours') AS entries_24h,
              (SELECT AVG(mood)::float8 FROM activities WHERE started_at >= now() - interval '24 hours' AND mood IS NOT NULL) AS mood_24h
       FROM activities WHERE started_at >= now() - interval '3 hours'`,
    ),
    listCategories(),
  ]);

  const layers = buildLayers(rows, cats, n, bucketMinutes);
  const energy = Math.max(0.05, Math.min(1, pulse.energy_min / 180));
  const tempo = 0.7 + 0.8 * Math.min(1, pulse.entries_24h / 12);
  res.json({
    range: rangeKey,
    generatedAt: t1.toISOString(),
    window: { from: t0.toISOString(), to: t1.toISOString() },
    buckets: n,
    bucketMinutes,
    seed: artSeed(rangeKey, { latestId: stats.latest_id, count: stats.count, minutes: stats.minutes }),
    energy: Number(energy.toFixed(3)),
    tempo: Number(tempo.toFixed(3)),
    mood: pulse.mood_24h ? Number(pulse.mood_24h.toFixed(2)) : 3,
    totals: { minutes: stats.minutes, entries: stats.count },
    layers,
  });
});
