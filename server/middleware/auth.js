import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/validate.js';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** When API_TOKEN is set, every mutating /api request must carry it. Reads stay open. */
export function requireToken(req, res, next) {
  if (!config.apiToken) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || req.get('x-api-token') || (typeof req.query.token === 'string' ? req.query.token : '');
  if (token && safeEqual(token, config.apiToken)) return next();
  next(new HttpError(401, 'unauthorized: set Authorization: Bearer <API_TOKEN>'));
}
