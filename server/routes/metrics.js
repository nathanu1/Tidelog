import { Router } from 'express';
import { query } from '../db.js';
import { ACTIVITY_SELECT } from '../lib/activities.js';
import { focusScore, balanceScore, streakDays, average, rangeSpec, isValidTimeZone } from '../lib/metrics.js';
import { listCategories } from '../lib/categories.js';
import { clientCount } from '../events.js';

export const metrics = Router();

metrics.get('/', async (req, res) => {
  const rangeKey = ['24h', '7d', '30d'].includes(req.query.range) ? req.query.range : '24h';
  const spec = rangeSpec(rangeKey);
  const tz = isValidTimeZone(req.query.tz) ? req.query.tz : 'UTC';

  // Local "today" and the window start, computed by Postgres in the caller's time zone.
  const { rows: [clock] } = await query(
    `SELECT (now() AT TIME ZONE $1)::date::text AS today,
            ((now() AT TIME ZONE $1)::date - ($2::int - 1))::text AS start_date,
            (((now() AT TIME ZONE $1)::date - ($2::int - 1))::timestamp AT TIME ZONE $1) AS day_t0`,
    [tz, spec.seriesPoints],
  );
  const now = new Date();
  const t0 = spec.seriesKind === 'hour' ? new Date(now.getTime() - spec.hours * 3_600_000) : new Date(clock.day_t0);

  const { rows } = await query(
    `SELECT a.id, a.duration_min, a.intensity, a.mood, a.started_at, a.category_id,
            (a.started_at AT TIME ZONE $2)::date::text AS local_date,
            EXTRACT(HOUR FROM a.started_at AT TIME ZONE $2)::int AS local_hour
     FROM activities a WHERE a.started_at >= $1 AND a.started_at <= now() + interval '1 day'`,
    [t0, tz],
  );
  const cats = await listCategories();
  const catById = new Map(cats.map((c) => [c.id, c]));

  // Series buckets
  const points = spec.seriesPoints;
  const series = Array.from({ length: points }, () => ({ minutes: 0, entries: 0, wsum: 0, wden: 0, moods: [], cats: new Set() }));
  const dayIndex = (localDate) => Math.round((Date.parse(localDate + 'T00:00:00Z') - Date.parse(clock.start_date + 'T00:00:00Z')) / 86_400_000);
  const byHour = new Array(24).fill(0);
  const byCat = new Map();
  let totalMinutes = 0;
  for (const r of rows) {
    const idx = spec.seriesKind === 'hour'
      ? Math.floor((new Date(r.started_at).getTime() - t0.getTime()) / 3_600_000)
      : dayIndex(r.local_date);
    if (idx >= 0 && idx < points) {
      const b = series[idx];
      b.minutes += r.duration_min;
      b.entries += 1;
      b.wsum += Math.max(r.duration_min, 1) * r.intensity;
      b.wden += Math.max(r.duration_min, 1) * 5;
      if (r.mood) b.moods.push(r.mood);
      b.cats.add(r.category_id);
    }
    byHour[r.local_hour] += r.duration_min;
    totalMinutes += r.duration_min;
    const c = byCat.get(r.category_id) || { minutes: 0, entries: 0 };
    c.minutes += r.duration_min;
    c.entries += 1;
    byCat.set(r.category_id, c);
  }
  const byCategory = [...byCat.entries()]
    .map(([id, v]) => ({ ...catById.get(id), ...v, share: totalMinutes ? Number((v.minutes / totalMinutes).toFixed(3)) : 0 }))
    .filter((c) => c.slug)
    .sort((a, b) => b.minutes - a.minutes)
    .map(({ id, sort_order, ...rest }) => rest);

  const seriesOut = series.map((b, i) => ({
    i,
    minutes: b.minutes,
    entries: b.entries,
    focus: b.wden ? Math.round((b.wsum / b.wden) * 100) : 0,
    mood: b.moods.length ? Number(average(b.moods).toFixed(2)) : null,
    categories: b.cats.size,
  }));

  const [{ rows: dateRows }, { rows: todayRows }, { rows: recent }, { rows: [all] }] = await Promise.all([
    query(`SELECT DISTINCT (started_at AT TIME ZONE $1)::date::text AS d FROM activities WHERE started_at > now() - interval '400 days'`, [tz]),
    query(`SELECT COALESCE(SUM(duration_min), 0)::int AS minutes, COUNT(*)::int AS entries FROM activities WHERE (started_at AT TIME ZONE $1)::date = $2::date`, [tz, clock.today]),
    query(`${ACTIVITY_SELECT} ORDER BY a.started_at DESC, a.id DESC LIMIT 25`),
    query(`SELECT COUNT(*)::int AS entries, COALESCE(SUM(duration_min), 0)::int AS minutes, MIN(started_at) AS first_at FROM activities`),
  ]);

  let peakHour = null;
  let peakMinutes = 0;
  byHour.forEach((m, h) => { if (m > peakMinutes) { peakMinutes = m; peakHour = h; } });

  res.json({
    range: rangeKey,
    tz,
    today: clock.today,
    generatedAt: now.toISOString(),
    window: { from: t0.toISOString(), to: now.toISOString(), kind: spec.seriesKind, points },
    totals: {
      minutes: totalMinutes,
      entries: rows.length,
      focus: focusScore(rows),
      balance: balanceScore(byCategory),
      avgMood: average(rows.map((r) => r.mood)),
      avgIntensity: average(rows.map((r) => r.intensity)),
    },
    todayTotals: { minutes: todayRows[0].minutes, entries: todayRows[0].entries },
    streakDays: streakDays(dateRows.map((r) => r.d), clock.today),
    peakHour,
    byHour,
    byCategory,
    series: seriesOut,
    recent,
    lifetime: { entries: all.entries, minutes: all.minutes, firstAt: all.first_at },
    liveClients: clientCount(),
  });
});
