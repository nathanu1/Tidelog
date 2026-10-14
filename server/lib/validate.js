export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (msg, details) => new HttpError(400, msg, details);

export function str(v, { field, max = 200, required = false, allowEmpty = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${field} must be a string`);
  const s = v.trim();
  if (!s && !allowEmpty) {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}

export function int(v, { field, min = -Infinity, max = Infinity, def = undefined } = {}) {
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    return null;
  }
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || Math.round(n) !== n) throw bad(`${field} must be an integer`);
  if (n < min || n > max) throw bad(`${field} must be between ${min} and ${max}`);
  return n;
}

export function tags(v, { field = 'tags' } = {}) {
  if (v === undefined || v === null) return [];
  let list = v;
  if (typeof v === 'string') list = v.split(/[,\s]+/);
  if (!Array.isArray(list)) throw bad(`${field} must be an array of strings`);
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') throw bad(`${field} must be an array of strings`);
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (!t) continue;
    if (t.length > 30) throw bad(`each tag must be at most 30 characters`);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 12) throw bad(`at most 12 tags`);
  return out;
}

export function timestamp(v, { field = 'started_at' } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw bad(`${field} must be an ISO-8601 date`);
  const now = Date.now();
  if (d.getTime() > now + 86_400_000) throw bad(`${field} cannot be more than a day in the future`);
  if (d.getTime() < now - 10 * 365 * 86_400_000) throw bad(`${field} is too far in the past`);
  return d;
}
