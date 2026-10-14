#!/usr/bin/env node
// logtrack — log activity from the terminal (and from any script that can run node).
//
//   logtrack "45m deep work on the renderer @work #focus !4 ~5"
//   logtrack start "Writing the spec @work"
//   logtrack stop ~4
//   logtrack status | today | recent [n] | cats | art
//
// Env: LOGTRACK_URL (default http://localhost:3000), LOGTRACK_TOKEN (if the server sets API_TOKEN)

const BASE = (process.env.LOGTRACK_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.LOGTRACK_TOKEN || '';
const args = process.argv.slice(2);

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    fail(`cannot reach ${BASE} (${err.cause?.code || err.message}). Is the server running? Set LOGTRACK_URL to point elsewhere.`);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${data.error || res.statusText}${data.details?.known ? ` (known: ${data.details.known.join(', ')})` : ''}`);
  return data;
}

function fail(msg) {
  console.error(`logtrack: ${msg}`);
  process.exit(1);
}

const fmtMin = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
const paint = (hex, text) => {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}\x1b[0m`;
};
const ago = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function printActivity(a) {
  console.log(`${paint(a.category_color, '●')} ${a.title}  ${paint('#9b9388', `${a.category_name} · ${fmtMin(a.duration_min)} · !${a.intensity}${a.mood ? ` ~${a.mood}` : ''}${a.tags.length ? ' · #' + a.tags.join(' #') : ''} · ${ago(a.started_at)}`)}`);
}

const usage = `logtrack — log activity, grow the artwork

  logtrack "45m deep work on the renderer @work #focus !4 ~5"   log an activity
  logtrack start "Writing the spec @work #docs"                 start a timer
  logtrack stop [~mood]                                         stop the timer and log it
  logtrack status                                               show the running timer
  logtrack today                                                today's totals
  logtrack recent [n]                                           last n entries
  logtrack cats                                                 list categories
  logtrack art [24h|7d|30d]                                     render the envelopes in the terminal

Shorthand: 45m / 1h30m duration · @category · #tag · !1-5 intensity · ~1-5 mood
Server: ${BASE}${TOKEN ? ' (token set)' : ''}`;

async function main() {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') return console.log(usage);

  switch (cmd) {
    case 'start': {
      const text = rest.join(' ').trim();
      if (!text) fail('what are you starting? e.g. logtrack start "Writing the spec @work"');
      const { timer } = await api('/api/timers/start', { method: 'POST', body: { text } });
      console.log(`${paint(timer.category_color, '▶')} timer started: ${timer.title} (${timer.category_name})`);
      return;
    }
    case 'stop': {
      const mood = rest.join(' ').match(/~([1-5])/);
      const { activity } = await api('/api/timers/stop', { method: 'POST', body: mood ? { mood: Number(mood[1]) } : {} });
      console.log('■ stopped and logged:');
      printActivity(activity);
      return;
    }
    case 'status': {
      const { timer } = await api('/api/timers/active');
      if (!timer) return console.log('no timer running');
      const min = Math.floor((Date.now() - new Date(timer.started_at).getTime()) / 60000);
      console.log(`${paint(timer.category_color, '▶')} ${timer.title} (${timer.category_name}) — ${fmtMin(min)} elapsed`);
      return;
    }
    case 'today': {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const m = await api(`/api/metrics?range=24h&tz=${encodeURIComponent(tz)}`);
      console.log(`today: ${fmtMin(m.todayTotals.minutes)} over ${m.todayTotals.entries} entries · streak ${m.streakDays}d · focus ${m.totals.focus} · balance ${m.totals.balance}${m.totals.avgMood ? ` · mood ${m.totals.avgMood.toFixed(1)}` : ''}`);
      for (const c of m.byCategory) console.log(`  ${paint(c.color, '■')} ${c.name.padEnd(10)} ${fmtMin(c.minutes).padStart(7)}  ${'▇'.repeat(Math.round(c.share * 30))}`);
      return;
    }
    case 'recent': {
      const n = Math.min(100, Number(rest[0]) || 10);
      const { activities } = await api(`/api/activities?limit=${n}`);
      if (!activities.length) return console.log('nothing logged yet');
      activities.forEach(printActivity);
      return;
    }
    case 'cats': {
      const { categories } = await api('/api/categories');
      for (const c of categories) console.log(`${paint(c.color, '■')} @${c.slug.padEnd(10)} ${c.name}`);
      return;
    }
    case 'art': {
      const range = ['24h', '7d', '30d'].includes(rest[0]) ? rest[0] : '24h';
      const a = await api(`/api/art?range=${range}`);
      const blocks = ' ▁▂▃▄▅▆▇█';
      if (!a.layers.length) return console.log('nothing in this window yet');
      for (const l of a.layers) {
        const row = l.env.map((v) => blocks[Math.min(8, Math.round(v * 8))]).join('');
        console.log(`${l.name.padEnd(9)} ${paint(l.color, row)} ${fmtMin(l.minutes)}`);
      }
      console.log(`seed ${a.seed} · energy ${Math.round(a.energy * 100)} · tempo ${a.tempo}× · ${range}`);
      return;
    }
    default: {
      const text = args.join(' ').trim();
      const a = await api('/api/activities/quick', { method: 'POST', body: { text, source: 'cli' } });
      console.log('logged:');
      printActivity(a);
    }
  }
}

main().catch((err) => fail(err.message));
