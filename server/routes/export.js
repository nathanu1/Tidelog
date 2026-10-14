import { Router } from 'express';
import { query } from '../db.js';
import { ACTIVITY_SELECT } from '../lib/activities.js';

export const exporter = Router();

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(' ') : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

exporter.get('/export.csv', async (req, res) => {
  const { rows } = await query(`${ACTIVITY_SELECT} ORDER BY a.started_at ASC, a.id ASC`);
  const cols = ['id', 'started_at', 'category', 'title', 'duration_min', 'intensity', 'mood', 'tags', 'source', 'note', 'created_at'];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="logdatatrack-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n') + '\n');
});

exporter.get('/export.json', async (req, res) => {
  const { rows } = await query(`${ACTIVITY_SELECT} ORDER BY a.started_at ASC, a.id ASC`);
  res.setHeader('Content-Disposition', `attachment; filename="logdatatrack-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), activities: rows });
});
