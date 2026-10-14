// Pure metric helpers (no DB access) so they can be unit tested.

/** Weighted intensity, 0..100. */
export function focusScore(rows) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const m = Math.max(r.duration_min, 1);
    num += m * r.intensity;
    den += m * 5;
  }
  return den ? Math.round((num / den) * 100) : 0;
}

/** Normalized Shannon entropy of minutes per category, 0..100. */
export function balanceScore(byCategory) {
  const totals = byCategory.map((c) => c.minutes).filter((m) => m > 0);
  const sum = totals.reduce((a, b) => a + b, 0);
  if (totals.length < 2 || !sum) return 0;
  let h = 0;
  for (const m of totals) {
    const p = m / sum;
    h -= p * Math.log(p);
  }
  return Math.round((h / Math.log(totals.length)) * 100);
}

/**
 * Consecutive days with at least one entry, counting back from today
 * (or from yesterday when today is still empty, so the streak is not lost before the day ends).
 * @param {string[]} dates  local dates 'YYYY-MM-DD', any order
 * @param {string} today    local date 'YYYY-MM-DD'
 */
export function streakDays(dates, today) {
  const set = new Set(dates);
  let cursor = today;
  if (!set.has(cursor)) cursor = addDays(cursor, -1);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function addDays(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function average(values) {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export const RANGES = {
  '24h': { hours: 24, buckets: 48, seriesKind: 'hour', seriesPoints: 24 },
  '7d': { hours: 24 * 7, buckets: 84, seriesKind: 'day', seriesPoints: 7 },
  '30d': { hours: 24 * 30, buckets: 90, seriesKind: 'day', seriesPoints: 30 },
};

export function rangeSpec(key) {
  return RANGES[key] || RANGES['24h'];
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
