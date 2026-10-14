import { WaveArt } from './art.js';
import { parseQuick } from '../../shared/quickparse.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  range: localStorage.getItem('ldt.range') || '24h',
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  token: localStorage.getItem('ldt.token') || '',
  categories: [],
  metrics: null,
  art: null,
  timer: null,
  form: { category: null, intensity: 3, mood: null, when: 'finished' },
  signalHistory: new Array(40).fill(0),
  shown: new Map(),
  selfIds: new Set(),
};

/* ---------- helpers ---------- */
const fmtMinutes = (m) => {
  m = Math.round(m || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};
const fmtClock = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
const timeAgo = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, { err = false, color = null, ms = 2800 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.innerHTML = `${color ? `<span class="sw" style="background:${esc(color)}"></span>` : ''}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

async function api(path, { method = 'GET', body, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && retry) {
    const token = window.prompt('This server protects writes with an API token. Paste it to continue:');
    if (token) {
      state.token = token.trim();
      localStorage.setItem('ldt.token', state.token);
      return api(path, { method, body, retry: false });
    }
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `${res.status} ${res.statusText}`);
    e.status = res.status;
    e.details = data.details;
    throw e;
  }
  return data;
}

/* ---------- renderer ---------- */
const canvas = $('#art');
const art = new WaveArt(canvas);
art.start();
window.addEventListener('resize', debounce(() => art.resize(), 80));
document.addEventListener('visibilitychange', () => (document.hidden ? art.stop() : art.start()));

/* ---------- data ---------- */
async function loadCategories() {
  const { categories } = await api('/api/categories');
  state.categories = categories;
  renderCategoryChips();
}

async function refreshData({ keepSeed = true } = {}) {
  const [metrics, artData] = await Promise.all([
    api(`/api/metrics?range=${state.range}&tz=${encodeURIComponent(state.tz)}`),
    api(`/api/art?range=${state.range}`),
  ]);
  state.metrics = metrics;
  state.art = artData;
  art.setData(artData, { keepSeed });
  renderMetrics(metrics);
  renderLegend(artData);
  renderRecent(metrics.recent);
  $('#empty').hidden = artData.layers.length > 0;
}
const refreshSoon = debounce(() => refreshData().catch((e) => toast(e.message, { err: true })), 250);

/* ---------- metrics strip ---------- */
function sparkline(values, { w = 100, h = 22 } = {}) {
  const v = values.map((x) => (x === null || x === undefined || Number.isNaN(x) ? 0 : x));
  if (v.length < 2) return '';
  const max = Math.max(...v, 1e-9);
  const pts = v.map((y, i) => [((i / (v.length - 1)) * w).toFixed(1), (h - 2 - (y / max) * (h - 4)).toFixed(1)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="rgba(255,255,255,0.08)"/><path d="${line}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
}

function tween(el, key, to, fmt, ms = 650) {
  const from = state.shown.get(key) ?? to;
  state.shown.set(key, to);
  if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) { el.innerHTML = fmt(to); return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const TILES = [
  { key: 'signal', label: 'Signal', live: true, sub: 'live amplitude' },
  { key: 'logged', label: 'Logged' },
  { key: 'focus', label: 'Focus' },
  { key: 'balance', label: 'Balance' },
  { key: 'streak', label: 'Streak' },
  { key: 'mood', label: 'Mood' },
  { key: 'peak', label: 'Peak hour' },
];

function ensureTiles() {
  const root = $('#metrics');
  if (root.children.length) return;
  root.innerHTML = TILES.map((t) => `
    <div class="tile${t.live ? ' live-tile' : ''}" data-key="${t.key}">
      <div class="label"><span>${t.label}</span></div>
      <div class="value">–</div>
      <div class="sub">${t.sub || ''}</div>
      <div class="spark"></div>
    </div>`).join('');
}

function setTile(key, { value, numeric, fmt, sub, series, label }) {
  const el = $(`.tile[data-key="${key}"]`);
  if (!el) return;
  if (label) $('.label span', el).textContent = label;
  if (numeric !== undefined) tween($('.value', el), key, numeric, fmt);
  else $('.value', el).innerHTML = value;
  if (sub !== undefined) $('.sub', el).textContent = sub;
  if (series) $('.spark', el).innerHTML = sparkline(series);
}

function renderMetrics(m) {
  ensureTiles();
  const r = m.range;
  setTile('logged', {
    label: `Logged · ${r}`,
    numeric: m.totals.minutes,
    fmt: (v) => fmtMinutes(v),
    sub: `${m.totals.entries} entries · today ${fmtMinutes(m.todayTotals.minutes)}`,
    series: m.series.map((s) => s.minutes),
  });
  setTile('focus', {
    numeric: m.totals.focus,
    fmt: (v) => `${Math.round(v)}<small>/100</small>`,
    sub: `avg intensity ${m.totals.avgIntensity ? m.totals.avgIntensity.toFixed(1) : '–'}`,
    series: m.series.map((s) => s.focus),
  });
  setTile('balance', {
    numeric: m.totals.balance,
    fmt: (v) => `${Math.round(v)}<small>/100</small>`,
    sub: `${m.byCategory.length} categor${m.byCategory.length === 1 ? 'y' : 'ies'} in play`,
    series: m.series.map((s) => s.categories),
  });
  setTile('streak', {
    numeric: m.streakDays,
    fmt: (v) => `${Math.round(v)}<small>d</small>`,
    sub: `${m.lifetime.entries} entries all time`,
    series: m.series.map((s) => s.entries),
  });
  setTile('mood', {
    numeric: m.totals.avgMood ?? 0,
    fmt: (v) => (m.totals.avgMood ? `${v.toFixed(1)}<small>/5</small>` : '–'),
    sub: m.totals.avgMood ? ['rough', 'low', 'steady', 'good', 'great'][Math.round(m.totals.avgMood) - 1] : 'no mood logged',
    series: m.series.map((s) => s.mood ?? 0),
  });
  setTile('peak', {
    value: m.peakHour === null ? '–' : `${String(m.peakHour).padStart(2, '0')}<small>:00</small>`,
    sub: m.peakHour === null ? 'no data' : 'most active hour',
    series: m.byHour,
  });
}

setInterval(() => {
  const s = art.getSignal();
  state.signalHistory.push(s);
  state.signalHistory.shift();
  const el = $('.tile[data-key="signal"]');
  if (!el) return;
  $('.value', el).innerHTML = `${Math.round(s)}<small>/100</small>`;
  $('.sub', el).textContent = `peak ${Math.round(art.peak * 100)} · tempo ${art.tempo.toFixed(2)}× · energy ${Math.round(art.energy * 100)}`;
  $('.spark', el).innerHTML = sparkline(state.signalHistory);
}, 120);

/* ---------- legend ---------- */
function renderLegend(a) {
  const root = $('#legend');
  const layers = [...a.layers].sort((x, y) => y.minutes - x.minutes);
  root.innerHTML = layers.map((l) => `
    <button class="chip${art.isVisible(l.slug) ? '' : ' off'}" data-slug="${esc(l.slug)}" title="Toggle ${esc(l.name)}">
      <span class="sw" style="background:${esc(l.color)}"></span>${esc(l.name)}<span class="m">${fmtMinutes(l.minutes)}</span>
    </button>`).join('');
  $$('.chip', root).forEach((chip) => chip.addEventListener('click', () => {
    const slug = chip.dataset.slug;
    const next = !art.isVisible(slug);
    art.setVisible(slug, next);
    chip.classList.toggle('off', !next);
  }));
}

/* ---------- recent list ---------- */
function renderRecent(list) {
  const root = $('#recent');
  if (!list?.length) { root.innerHTML = '<li class="muted small">Nothing yet.</li>'; return; }
  root.innerHTML = list.map((a) => `
    <li data-id="${a.id}">
      <span class="sw" style="background:${esc(a.category_color)}"></span>
      <span class="t">${esc(a.title)}<small>${esc(a.category_name)} · ${timeAgo(a.started_at)}${a.tags?.length ? ' · #' + a.tags.map(esc).join(' #') : ''}${a.source && a.source !== 'web' ? ' · via ' + esc(a.source) : ''}</small></span>
      <span class="d">${fmtMinutes(a.duration_min)}</span>
      <button class="x" title="Delete" aria-label="Delete">×</button>
    </li>`).join('');
  $$('li .x', root).forEach((btn) => btn.addEventListener('click', async () => {
    const li = btn.closest('li');
    try {
      await api(`/api/activities/${li.dataset.id}`, { method: 'DELETE' });
      li.remove();
      toast('Deleted');
      refreshSoon();
    } catch (e) { toast(e.message, { err: true }); }
  }));
}

/* ---------- live events ---------- */
function connectEvents() {
  const es = new EventSource('/api/events');
  const live = $('#live');
  es.addEventListener('hello', () => live.classList.add('on'));
  es.onerror = () => live.classList.remove('on');
  const beat = () => { const p = $('#pulse'); p.classList.remove('beat'); void p.offsetWidth; p.classList.add('beat'); };
  es.addEventListener('activity.created', (ev) => {
    const a = JSON.parse(ev.data);
    beat();
    if (!state.selfIds.has(a.id) && a.source && a.source !== 'web') toast(`Logged via ${a.source}: ${a.title} · ${fmtMinutes(a.duration_min)}`, { color: a.category_color });
    refreshSoon();
  });
  for (const type of ['activity.updated', 'activity.deleted', 'categories.changed']) es.addEventListener(type, () => { beat(); refreshSoon(); if (type === 'categories.changed') loadCategories(); });
  es.addEventListener('timer.started', (ev) => { state.timer = JSON.parse(ev.data); renderTimer(); });
  es.addEventListener('timer.stopped', () => { state.timer = null; renderTimer(); refreshSoon(); });
  es.addEventListener('artwork.created', () => { if ($('#gallery').classList.contains('open')) loadGallery(); });
}

/* ---------- drawer + form ---------- */
const drawer = $('#drawer');
const quick = $('#quick');

function openDrawer() { closeAll({ keepDrawer: true }); drawer.classList.add('open'); setTimeout(() => quick.focus(), 60); }
function closeAll({ keepDrawer = false } = {}) {
  const active = document.activeElement;
  if (active && active.closest && active.closest('.drawer, .popover, .modal') && !(keepDrawer && drawer.contains(active))) active.blur();
  if (!keepDrawer) drawer.classList.remove('open');
  $('#gallery').classList.remove('open');
  $('#timer-pop').hidden = true;
  $('#save-modal').hidden = true;
  $('#about').hidden = true;
  closeViewer();
}

function renderCategoryChips() {
  const root = $('#cat-chips');
  root.innerHTML = state.categories.map((c) => `<button type="button" data-slug="${esc(c.slug)}" class="${state.form.category === c.slug ? 'active' : ''}"><span class="sw" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('');
  $$('button', root).forEach((b) => b.addEventListener('click', () => setCategory(b.dataset.slug)));
}
function setCategory(slug) {
  state.form.category = slug;
  $$('#cat-chips button').forEach((b) => b.classList.toggle('active', b.dataset.slug === slug));
}
function setSeg(id, value, prop) {
  state.form[prop] = value;
  $$(`#${id} button`).forEach((b) => b.classList.toggle('active', Number(b.dataset.v) === value));
}
function setDuration(min) {
  const slider = $('#duration');
  slider.value = Math.min(240, min);
  $('#dur-label').textContent = fmtMinutes(min);
  slider.dataset.min = min;
}

function applyParse() {
  const p = parseQuick(quick.value, state.categories);
  const preview = $('#parse-preview');
  const chips = [];
  if (p.title) chips.push(`<span>${esc(p.title)}</span>`);
  if (p.duration_min !== null) { chips.push(`<span>${fmtMinutes(p.duration_min)}</span>`); setDuration(p.duration_min); }
  if (p.category) {
    const c = state.categories.find((x) => x.slug === p.category);
    if (c) { chips.push(`<span class="cat" style="border-color:${esc(c.color)}">${esc(c.name)}</span>`); setCategory(c.slug); }
  }
  if (p.intensity) { chips.push(`<span>intensity ${p.intensity}</span>`); setSeg('intensity-seg', p.intensity, 'intensity'); }
  if (p.mood) { chips.push(`<span>mood ${p.mood}</span>`); setSeg('mood-seg', p.mood, 'mood'); }
  for (const t of p.tags) chips.push(`<span>#${esc(t)}</span>`);
  preview.innerHTML = chips.join('');
  return p;
}
quick.addEventListener('input', applyParse);

$('#duration').addEventListener('input', (e) => setDuration(Number(e.target.value)));
$$('#dur-presets button').forEach((b) => b.addEventListener('click', () => setDuration(Number(b.dataset.min))));
$$('#intensity-seg button').forEach((b) => b.addEventListener('click', () => setSeg('intensity-seg', Number(b.dataset.v), 'intensity')));
$$('#mood-seg button').forEach((b) => b.addEventListener('click', () => setSeg('mood-seg', state.form.mood === Number(b.dataset.v) ? null : Number(b.dataset.v), 'mood')));
$$('#when-seg button').forEach((b) => b.addEventListener('click', () => {
  state.form.when = b.dataset.when;
  $$('#when-seg button').forEach((x) => x.classList.toggle('active', x === b));
  const input = $('#started-at');
  input.hidden = b.dataset.when !== 'custom';
  if (!input.hidden && !input.value) {
    const d = new Date(Date.now() - 60_000 * Number($('#duration').dataset.min || 30));
    d.setSeconds(0, 0);
    input.value = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
}));

$('#log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = applyParse();
  const title = p.title || quick.value.trim();
  if (!title) { quick.focus(); return; }
  const duration = Number($('#duration').dataset.min ?? $('#duration').value);
  const tags = [...p.tags, ...$('#tags').value.split(/[,\s]+/).filter(Boolean)];
  const body = {
    title,
    category: state.form.category || p.category || undefined,
    duration_min: duration,
    intensity: state.form.intensity,
    mood: state.form.mood,
    tags,
    note: $('#note').value.trim() || undefined,
    source: 'web',
  };
  if (state.form.when === 'custom' && $('#started-at').value) body.started_at = new Date($('#started-at').value).toISOString();
  try {
    const a = await api('/api/activities', { method: 'POST', body });
    state.selfIds.add(a.id);
    toast(`Logged ${a.title} · ${fmtMinutes(a.duration_min)}`, { color: a.category_color });
    quick.value = '';
    $('#tags').value = '';
    $('#note').value = '';
    $('#parse-preview').innerHTML = '';
    setSeg('mood-seg', null, 'mood');
    quick.blur();
    drawer.classList.remove('open');
    refreshSoon();
  } catch (err) {
    toast(err.message, { err: true });
  }
});

/* ---------- timer ---------- */
let timerTick = null;
function renderTimer() {
  const t = state.timer;
  $('#timer').hidden = !t;
  $('#btn-timer').hidden = Boolean(t);
  clearInterval(timerTick);
  if (!t) return;
  $('#timer-title').textContent = t.title;
  $('#timer').style.borderColor = t.category_color;
  const update = () => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(t.started_at).getTime()) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    $('#timer-elapsed').textContent = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  update();
  timerTick = setInterval(update, 1000);
}
async function loadTimer() {
  const { timer } = await api('/api/timers/active');
  state.timer = timer;
  renderTimer();
}
function openTimerPop() {
  closeAll();
  const pop = $('#timer-pop');
  pop.hidden = false;
  setTimeout(() => $('#timer-input').focus(), 30);
}
async function startTimer() {
  const text = $('#timer-input').value.trim();
  if (!text) return;
  try {
    const { timer } = await api('/api/timers/start', { method: 'POST', body: { text } });
    state.timer = timer;
    renderTimer();
    $('#timer-pop').hidden = true;
    $('#timer-input').value = '';
    $('#timer-input').blur();
    toast(`Timer started: ${timer.title}`, { color: timer.category_color });
  } catch (e) { toast(e.message, { err: true }); }
}
async function stopTimer() {
  try {
    const { activity } = await api('/api/timers/stop', { method: 'POST', body: {} });
    state.selfIds.add(activity.id);
    state.timer = null;
    renderTimer();
    toast(`Logged ${activity.title} · ${fmtMinutes(activity.duration_min)}`, { color: activity.category_color });
    refreshSoon();
  } catch (e) { toast(e.message, { err: true }); }
}
$('#timer-input').addEventListener('input', (e) => {
  const p = parseQuick(e.target.value, state.categories);
  const c = state.categories.find((x) => x.slug === p.category);
  $('#timer-parse').textContent = [p.title, c?.name, p.tags.map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ');
});
$('#timer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startTimer(); } });
$('#btn-timer').addEventListener('click', openTimerPop);
$('#btn-timer-start').addEventListener('click', startTimer);
$('#btn-timer-stop').addEventListener('click', stopTimer);

/* ---------- save + download ---------- */
function downloadCanvas(cnv, name) {
  const a = document.createElement('a');
  a.href = cnv.toDataURL('image/png');
  a.download = name;
  a.click();
}
function openSave() {
  closeAll();
  if (!state.art?.layers?.length) { toast('Nothing to save yet: log something first', { err: true }); return; }
  $('#save-modal').hidden = false;
  const input = $('#save-title');
  input.value = '';
  input.placeholder = `${state.range} · ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  setTimeout(() => input.focus(), 30);
}
async function confirmSave() {
  const title = $('#save-title').value.trim() || $('#save-title').placeholder;
  try {
    const thumb = art.snapshot(720, 450, 1).toDataURL('image/jpeg', 0.82);
    const params = art.serialize();
    const saved = await api('/api/artworks', { method: 'POST', body: { title, seed: art.seed, range: state.range, params, thumbnail: thumb } });
    $('#save-modal').hidden = true;
    $('#save-title').blur();
    toast(`Saved “${saved.title}”`);
  } catch (e) { toast(e.message, { err: true }); }
}
$('#btn-save').addEventListener('click', openSave);
$('#btn-save-confirm').addEventListener('click', confirmSave);
$('#save-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSave(); });

/* ---------- gallery + viewer ---------- */
let viewerArt = null;
let viewerItem = null;
async function loadGallery() {
  const grid = $('#gallery-grid');
  const { artworks } = await api('/api/artworks');
  if (!artworks.length) { grid.innerHTML = '<div class="gallery-empty">No saved pieces yet. Press <kbd>S</kbd> to save the current one.</div>'; return; }
  grid.innerHTML = artworks.map((a) => `
    <div class="art-card" data-id="${a.id}">
      ${a.thumbnail ? `<img src="${a.thumbnail}" alt="${esc(a.title)}" loading="lazy" />` : '<div class="noimg">no thumbnail</div>'}
      <div class="cap">${esc(a.title)}<small>${esc(a.range_key)} · ${a.layer_count} layers · ${fmtDate(a.created_at)} ${fmtClock(a.created_at)}</small></div>
    </div>`).join('');
  $$('.art-card', grid).forEach((card) => card.addEventListener('click', () => openViewer(Number(card.dataset.id))));
}
function openGallery() { closeAll(); $('#gallery').classList.add('open'); loadGallery().catch((e) => toast(e.message, { err: true })); }
async function openViewer(id) {
  try {
    const item = await api(`/api/artworks/${id}`);
    viewerItem = item;
    const modal = $('#viewer');
    modal.hidden = false;
    $('#viewer-title').textContent = item.title;
    $('#viewer-meta').textContent = ` seed ${item.seed} · ${item.range_key} · ${fmtDate(item.created_at)} ${fmtClock(item.created_at)}`;
    const c = $('#viewer-canvas');
    viewerArt?.stop();
    viewerArt = WaveArt.fromParams(c, item.params);
    viewerArt.resize();
    viewerArt.start();
  } catch (e) { toast(e.message, { err: true }); }
}
function closeViewer() {
  $('#viewer').hidden = true;
  viewerArt?.stop();
  viewerArt = null;
  viewerItem = null;
}
$('#viewer-download').addEventListener('click', () => {
  if (!viewerArt) return;
  downloadCanvas(viewerArt.snapshot(1920, 1200, 1), `logdatatrack-${viewerItem?.id || 'piece'}.png`);
});
$('#viewer-delete').addEventListener('click', async () => {
  if (!viewerItem || !window.confirm(`Delete “${viewerItem.title}”?`)) return;
  try {
    await api(`/api/artworks/${viewerItem.id}`, { method: 'DELETE' });
    closeViewer();
    toast('Deleted');
    loadGallery();
  } catch (e) { toast(e.message, { err: true }); }
});
$('#btn-gallery').addEventListener('click', openGallery);

/* ---------- misc UI ---------- */
$('#btn-log').addEventListener('click', openDrawer);
$('#btn-focus').addEventListener('click', () => document.body.classList.toggle('focus'));
$('#btn-about').addEventListener('click', () => { closeAll(); $('#about').hidden = false; });
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeAll()));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeAll(); }));
canvas.addEventListener('click', () => { if (document.body.classList.contains('focus')) document.body.classList.remove('focus'); });
$$('.ranges button').forEach((b) => b.addEventListener('click', () => setRange(b.dataset.range)));

function setRange(r) {
  state.range = r;
  localStorage.setItem('ldt.range', r);
  $$('.ranges button').forEach((b) => b.classList.toggle('active', b.dataset.range === r));
  refreshData().catch((e) => toast(e.message, { err: true }));
}

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape') { closeAll(); document.body.classList.remove('focus'); document.activeElement?.blur?.(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key.toLowerCase()) {
    case 'l': e.preventDefault(); openDrawer(); break;
    case 't': e.preventDefault(); state.timer ? stopTimer() : openTimerPop(); break;
    case 'g': e.preventDefault(); openGallery(); break;
    case 's': e.preventDefault(); openSave(); break;
    case 'f': e.preventDefault(); document.body.classList.toggle('focus'); break;
    case 'r': e.preventDefault(); toast(`New seed ${art.reseed()}`); break;
    case 'd': e.preventDefault(); downloadCanvas(art.snapshot(1920, 1200, 1), `logdatatrack-${Date.now()}.png`); break;
    case '1': setRange('24h'); break;
    case '2': setRange('7d'); break;
    case '3': setRange('30d'); break;
    default: break;
  }
});

/* ---------- boot ---------- */
(async function boot() {
  ensureTiles();
  $$('.ranges button').forEach((b) => b.classList.toggle('active', b.dataset.range === state.range));
  setDuration(30);
  try {
    await loadCategories();
    await refreshData();
    await loadTimer();
    connectEvents();
  } catch (e) {
    toast(`Could not reach the server: ${e.message}`, { err: true, ms: 6000 });
  }
})();
