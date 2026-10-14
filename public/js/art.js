// WaveArt: turns activity envelopes into a living, layered waveform.
// Every category is a translucent ribbon mirrored around a centre axis; its height along the
// timeline is how much of that time slice you spent on it, its ripple speed is how intense it was.
import { Noise } from './noise.js';
import { hash2, mulberry32 } from '../../shared/prng.js';

export const SAMPLES = 240;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/** Gaussian-smooth N bucket values and resample them to `samples` points with Catmull-Rom. */
export function resampleEnvelope(values, samples = SAMPLES, sigma = 1.15) {
  const n = values.length;
  const out = new Float32Array(samples);
  if (!n) return out;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const w = kernel[k + radius];
      sum += values[j] * w;
      wsum += w;
    }
    smooth[i] = wsum ? sum / wsum : 0;
  }
  const at = (i) => smooth[clamp(i, 0, n - 1)];
  for (let s = 0; s < samples; s++) {
    const pos = (s / (samples - 1)) * (n - 1);
    const i = Math.floor(pos);
    const t = pos - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out[s] = Math.max(0, v);
  }
  return out;
}

function makeLayer(src, index) {
  const rgb = hexToRgb(src.color);
  return {
    slug: src.slug,
    name: src.name,
    color: src.color,
    rgb,
    light: mix(rgb, WHITE, 0.42),
    dark: mix(rgb, BLACK, 0.38),
    raw: Array.from(src.env || []),
    rawInten: Array.from(src.inten || []),
    env: new Float32Array(SAMPLES),
    target: resampleEnvelope(src.env || []),
    inten: resampleEnvelope(src.inten || [], SAMPLES, 1.6),
    minutes: src.minutes || 0,
    entries: src.entries || 0,
    visible: true,
    alpha: 1,
    k: index,
    top: new Float32Array(SAMPLES),
    bot: new Float32Array(SAMPLES),
    dead: false,
  };
}

export class WaveArt {
  constructor(canvas, { interactive = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.interactive = interactive;
    this.layers = [];
    this.seed = 1;
    this.noise = new Noise(1);
    this.rng = mulberry32(1);
    this.energy = 0.3;
    this.energyTarget = 0.3;
    this.tempo = 1;
    this.tempoTarget = 1;
    this.mood = 3;
    this.moodTarget = 3;
    this.particles = [];
    this.t = 0;
    this.running = false;
    this.lastFrame = 0;
    this.signal = 0;
    this.peak = 0;
    this.range = '24h';
    this.frameCount = 0;
    this.outerTop = new Float32Array(SAMPLES);
    this.outerBot = new Float32Array(SAMPLES);
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this._loop = this._loop.bind(this);
    this.resize();
  }

  setSeed(seed) {
    this.seed = seed >>> 0;
    this.noise = new Noise(this.seed);
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
  }

  reseed() {
    this.setSeed((this.seed * 1103515245 + 12345 + Math.floor(Math.random() * 1e6)) >>> 0);
    return this.seed;
  }

  /**
   * Feed new data. Existing ribbons morph smoothly toward the new envelopes;
   * ribbons that vanished fade out, new ones grow in.
   */
  setData(data, { keepSeed = true } = {}) {
    if (!data) return;
    if (!keepSeed || !this._seeded) {
      this.setSeed(Number(data.seed) || 1);
      this._seeded = true;
    }
    this.range = data.range || this.range;
    this.energyTarget = clamp(Number(data.energy) || 0.05, 0.02, 1);
    this.tempoTarget = clamp(Number(data.tempo) || 1, 0.3, 2.5);
    this.moodTarget = clamp(Number(data.mood) || 3, 1, 5);
    const incoming = new Map((data.layers || []).map((l) => [l.slug, l]));
    for (const layer of this.layers) {
      const src = incoming.get(layer.slug);
      if (src) {
        layer.raw = Array.from(src.env || []);
        layer.rawInten = Array.from(src.inten || []);
        layer.target = resampleEnvelope(src.env || []);
        layer.inten = resampleEnvelope(src.inten || [], SAMPLES, 1.6);
        layer.minutes = src.minutes || 0;
        layer.entries = src.entries || 0;
        layer.color = src.color || layer.color;
        layer.rgb = hexToRgb(layer.color);
        layer.light = mix(layer.rgb, WHITE, 0.42);
        layer.dark = mix(layer.rgb, BLACK, 0.38);
        layer.name = src.name || layer.name;
        layer.dead = false;
        incoming.delete(layer.slug);
      } else {
        layer.target = new Float32Array(SAMPLES);
        layer.dead = true;
      }
    }
    let k = this.layers.length;
    for (const src of incoming.values()) this.layers.push(makeLayer(src, k++));
    this.layers.forEach((l, i) => { l.k = i; });
  }

  setVisible(slug, visible) {
    const l = this.layers.find((x) => x.slug === slug);
    if (l) l.visible = visible;
  }

  isVisible(slug) {
    const l = this.layers.find((x) => x.slug === slug);
    return l ? l.visible : true;
  }

  serialize() {
    return {
      version: 1,
      seed: this.seed,
      range: this.range,
      t: Number(this.t.toFixed(3)),
      energy: Number(this.energy.toFixed(3)),
      tempo: Number(this.tempo.toFixed(3)),
      mood: Number(this.mood.toFixed(2)),
      totals: {
        minutes: this.layers.reduce((s, l) => s + (l.dead ? 0 : l.minutes), 0),
        entries: this.layers.reduce((s, l) => s + (l.dead ? 0 : l.entries), 0),
      },
      layers: this.layers
        .filter((l) => !l.dead && l.visible)
        .map((l) => ({ slug: l.slug, name: l.name, color: l.color, env: l.raw, inten: l.rawInten, minutes: l.minutes, entries: l.entries })),
    };
  }

  /** Rebuild a renderer from saved params (gallery viewer). */
  static fromParams(canvas, params, opts) {
    const art = new WaveArt(canvas, opts);
    art.setSeed(Number(params.seed) || 1);
    art._seeded = true;
    art.setData(params, { keepSeed: true });
    art.t = Number(params.t) || 0;
    art.energy = art.energyTarget;
    art.tempo = art.tempoTarget;
    art.mood = art.moodTarget;
    for (const l of art.layers) l.env.set(l.target);
    // Pre-roll particles so a saved piece does not start empty.
    art._computeCurves(art.W, art.H, art.t);
    for (let i = 0; i < 120; i++) art._spawnParticle();
    for (const p of art.particles) p.age = Math.random() * p.life * 0.8;
    return art;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, Math.round(rect.width || this.canvas.width || 1));
    this.H = Math.max(1, Math.round(rect.height || this.canvas.height || 1));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  getSignal() {
    return this.signal;
  }

  _loop(now) {
    if (!this.running) return;
    const dt = clamp((now - this.lastFrame) / 1000, 0, 0.1);
    this.lastFrame = now;
    this._step(dt);
    this.draw(this.ctx, this.W, this.H, this.t);
    requestAnimationFrame(this._loop);
  }

  _step(dt) {
    const ease = 1 - Math.exp(-dt * 1.6);
    this.energy += (this.energyTarget - this.energy) * ease;
    this.tempo += (this.tempoTarget - this.tempo) * ease;
    this.mood += (this.moodTarget - this.mood) * ease;
    this.t += dt * this.tempo;
    for (const layer of this.layers) {
      const env = layer.env;
      const target = layer.target;
      for (let i = 0; i < SAMPLES; i++) env[i] += (target[i] - env[i]) * ease;
      layer.alpha += ((layer.visible && !layer.dead ? 1 : 0) - layer.alpha) * ease * 1.4;
    }
    this.layers = this.layers.filter((l) => !(l.dead && l.alpha < 0.01));
    this.layers.forEach((l, i) => { l.k = i; });
    this._stepParticles(dt);
  }

  _computeCurves(W, H, t) {
    const maxAmp = H * 0.4;
    const noise = this.noise;
    const outerTop = this.outerTop;
    const outerBot = this.outerBot;
    outerTop.fill(0);
    outerBot.fill(0);
    let any = false;
    for (const layer of this.layers) {
      if (layer.alpha < 0.01) continue;
      any = true;
      const k = layer.k;
      const env = layer.env;
      const inten = layer.inten;
      const top = layer.top;
      const bot = layer.bot;
      const o1 = k * 7.31;
      const o2 = k * 3.7;
      for (let i = 0; i < SAMPLES; i++) {
        const x = i / (SAMPLES - 1);
        const win = smoothstep(0, 0.045, x) * smoothstep(1, 0.955, x);
        const base = Math.pow(env[i], 0.82) * win;
        if (base < 0.0005) { top[i] = 0; bot[i] = 0; continue; }
        const ripple = 0.035 + 0.11 * inten[i];
        const n1 = noise.fbm2(x * 2.6 + o1, t * 0.21 + o2, 3);
        const n2 = noise.value2(x * 7.5 + o1 - t * 0.55, o2 * 3.1 + t * 0.1);
        const n3 = noise.fbm2(x * 2.6 + o1 + 41.3, t * 0.19 + o2 + 9.7, 3);
        const n4 = noise.value2(x * 7.5 + o1 + 17.1 + t * 0.47, o2 * 2.3 + 23);
        const travel = 0.025 * Math.sin(x * 38 - t * 2.3 + k);
        const aTop = maxAmp * base * (0.8 + 0.2 * n1 + ripple * n2 + travel);
        const aBot = maxAmp * base * (0.64 + 0.26 * n3 + ripple * n4 - travel);
        top[i] = aTop > 0 ? aTop : 0;
        bot[i] = aBot > 0 ? aBot : 0;
        const at = top[i] * layer.alpha;
        const ab = bot[i] * layer.alpha;
        if (at > outerTop[i]) outerTop[i] = at;
        if (ab > outerBot[i]) outerBot[i] = ab;
      }
    }
    // Signal: live mean amplitude of the outer envelope, 0..100.
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const v = outerTop[i] + outerBot[i];
      sum += v;
      if (outerTop[i] > peak) peak = outerTop[i];
    }
    this.signal = any ? clamp((sum / SAMPLES / (2 * maxAmp)) * 100 * 2.2, 0, 100) : 0;
    this.peak = any ? clamp(peak / maxAmp, 0, 1) : 0;
    return maxAmp;
  }

  draw(ctx, W, H, t, { withParticles = true } = {}) {
    const cy = H * 0.52;
    const maxAmp = this._computeCurves(W, H, t);
    this.frameCount++;

    // Background: warm or cool depending on mood.
    const moodT = clamp((this.mood - 1) / 4, 0, 1);
    const inner = mix([20, 22, 28], [31, 25, 20], moodT);
    const outer = mix([9, 10, 13], [12, 10, 9], moodT);
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.72);
    bg.addColorStop(0, rgba(inner, 1));
    bg.addColorStop(1, rgba(outer, 1));
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const px = (i) => (i / (SAMPLES - 1)) * W;
    const order = this.layers.filter((l) => l.alpha >= 0.01).sort((a, b) => b.minutes - a.minutes);
    const meshStep = 12;

    if (!order.length) this._drawGhost(ctx, W, H, cy, maxAmp, t);

    for (const layer of order) {
      const { top, bot } = layer;
      const a = layer.alpha;
      // Ribbon fill with a lit gradient (lighter crest, darker trough).
      ctx.beginPath();
      ctx.moveTo(0, cy - top[0]);
      for (let i = 1; i < SAMPLES; i++) ctx.lineTo(px(i), cy - top[i]);
      for (let i = SAMPLES - 1; i >= 0; i--) ctx.lineTo(px(i), cy + bot[i]);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, cy - maxAmp, 0, cy + maxAmp);
      grad.addColorStop(0, rgba(layer.light, 1));
      grad.addColorStop(0.5, rgba(layer.rgb, 1));
      grad.addColorStop(1, rgba(layer.dark, 1));
      ctx.globalAlpha = 0.84 * a;
      ctx.fillStyle = grad;
      ctx.fill();

      // Wireframe mesh, clipped to the ribbon.
      ctx.save();
      ctx.clip();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.globalAlpha = 0.6 * a;
      ctx.beginPath();
      for (let x = meshStep * 0.5; x < W; x += meshStep) {
        const pos = (x / W) * (SAMPLES - 1);
        const i = Math.floor(pos);
        const f = pos - i;
        const i2 = Math.min(i + 1, SAMPLES - 1);
        const yt = lerp(top[i], top[i2], f);
        const yb = lerp(bot[i], bot[i2], f);
        if (yt + yb < 1.5) continue;
        ctx.moveTo(x, cy - yt - 1);
        ctx.lineTo(x, cy + yb + 1);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.42 * a;
      ctx.beginPath();
      for (const f of [0.18, 0.38, 0.58, 0.78]) {
        ctx.moveTo(0, cy - top[0] * f);
        for (let i = 1; i < SAMPLES; i++) ctx.lineTo(px(i), cy - top[i] * f);
        ctx.moveTo(0, cy + bot[0] * f);
        for (let i = 1; i < SAMPLES; i++) ctx.lineTo(px(i), cy + bot[i] * f);
      }
      ctx.stroke();
      ctx.restore();

      // Lit edges.
      ctx.globalAlpha = 0.75 * a;
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(0, cy - top[0]);
      for (let i = 1; i < SAMPLES; i++) ctx.lineTo(px(i), cy - top[i]);
      ctx.stroke();
      ctx.globalAlpha = 0.45 * a;
      ctx.beginPath();
      ctx.moveTo(0, cy + bot[0]);
      for (let i = 1; i < SAMPLES; i++) ctx.lineTo(px(i), cy + bot[i]);
      ctx.stroke();
    }

    this._drawHalo(ctx, W, cy, maxAmp, t, meshStep);
    this._drawSparkles(ctx, W, cy, maxAmp, t);
    if (withParticles) this._drawParticles(ctx, W, H, cy, t);

    // Centre axis.
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.moveTo(0, cy + 0.5);
    ctx.lineTo(W, cy + 0.5);
    ctx.stroke();
  }

  _drawGhost(ctx, W, H, cy, maxAmp, t) {
    // Empty state: a faint breathing ribbon so the canvas never feels dead.
    const px = (i) => (i / (SAMPLES - 1)) * W;
    ctx.beginPath();
    for (let i = 0; i < SAMPLES; i++) {
      const x = i / (SAMPLES - 1);
      const win = Math.sin(x * Math.PI);
      const y = maxAmp * 0.1 * win * (0.7 + 0.3 * this.noise.fbm2(x * 3 + 1, t * 0.2, 2));
      if (i === 0) ctx.moveTo(0, cy - y); else ctx.lineTo(px(i), cy - y);
    }
    for (let i = SAMPLES - 1; i >= 0; i--) {
      const x = i / (SAMPLES - 1);
      const win = Math.sin(x * Math.PI);
      const y = maxAmp * 0.08 * win * (0.7 + 0.3 * this.noise.fbm2(x * 3 + 7, t * 0.17, 2));
      ctx.lineTo(px(i), cy + y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#A6DBEA';
    ctx.fill();
  }

  _drawHalo(ctx, W, cy, maxAmp, t, step) {
    // Dotted columns rising from the crests, like the mesh continuing into the dark.
    const outerTop = this.outerTop;
    const outerBot = this.outerBot;
    const seed = this.seed;
    ctx.fillStyle = '#ffffff';
    let j = 0;
    for (let x = step * 0.5; x < W; x += step, j++) {
      const pos = (x / W) * (SAMPLES - 1);
      const i = Math.floor(pos);
      const f = pos - i;
      const i2 = Math.min(i + 1, SAMPLES - 1);
      const oT = lerp(outerTop[i], outerTop[i2], f);
      const oB = lerp(outerBot[i], outerBot[i2], f);
      const strengthT = clamp(oT / (maxAmp * 0.45), 0, 1);
      const strengthB = clamp(oB / (maxAmp * 0.45), 0, 1);
      if (oT > maxAmp * 0.05) {
        for (let k = 1; k <= 14; k++) {
          const r = hash2(j, k, seed);
          if (r > 0.56 - k * 0.034) continue;
          const tw = 0.5 + 0.5 * Math.sin(t * 1.9 + r * TAU * 3 + j * 0.31);
          const alpha = (0.95 - k * 0.055) * (0.45 + 0.55 * tw) * (0.3 + 0.7 * strengthT);
          const size = 1.3 + 1.5 * hash2(j, k + 100, seed);
          const y = cy - oT - k * step * 0.9 - 3 + Math.sin(t * 0.7 + r * 9) * 1.5;
          ctx.globalAlpha = alpha;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      if (oB > maxAmp * 0.05) {
        for (let k = 1; k <= 10; k++) {
          const r = hash2(j, k + 300, seed);
          if (r > 0.46 - k * 0.034) continue;
          const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + r * TAU * 3 + j * 0.27);
          const alpha = (0.8 - k * 0.06) * (0.45 + 0.55 * tw) * (0.3 + 0.7 * strengthB);
          const size = 1.2 + 1.4 * hash2(j, k + 400, seed);
          const y = cy + oB + k * step * 0.9 + 3 + Math.sin(t * 0.6 + r * 7) * 1.5;
          ctx.globalAlpha = alpha;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
    }
  }

  _drawSparkles(ctx, W, cy, maxAmp, t) {
    // A thin field of fixed, twinkling specks around the artwork (seeded, so saved pieces match).
    const seed = this.seed;
    ctx.fillStyle = '#ffffff';
    const count = 110;
    for (let n = 0; n < count; n++) {
      const rx = hash2(n, 1, seed);
      const ry = hash2(n, 2, seed);
      const x = rx * W;
      const y = cy + (ry - 0.5) * 2 * maxAmp * 1.35;
      const tw = 0.5 + 0.5 * Math.sin(t * (0.8 + hash2(n, 3, seed) * 1.6) + n * 1.7);
      ctx.globalAlpha = (0.12 + 0.38 * hash2(n, 4, seed)) * (0.35 + 0.65 * tw) * (0.4 + 0.6 * this.peak);
      const s = 1 + 1.6 * hash2(n, 5, seed);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }

  _spawnParticle() {
    const candidates = this.layers.filter((l) => l.alpha > 0.2);
    if (!candidates.length) return;
    const rnd = Math.random;
    const layer = candidates[Math.floor(rnd() * candidates.length)];
    let i = 0;
    let tries = 0;
    let found = false;
    const scale = this.H * 0.4;
    while (tries++ < 12) {
      i = Math.floor(rnd() * SAMPLES);
      if (layer.top[i] / scale > rnd() * 0.9 + 0.05) { found = true; break; }
    }
    if (!found) return;
    const above = rnd() < 0.62;
    const x = i / (SAMPLES - 1) + (rnd() - 0.5) * 0.012;
    const y = above ? -(layer.top[i] + 6 + rnd() * 90) : layer.bot[i] + 6 + rnd() * 60;
    this.particles.push({
      x,
      y: y / this.H,
      vx: ((rnd() - 0.5) * 7) / this.W,
      vy: (above ? -(3 + rnd() * 11) : 2 + rnd() * 8) / this.H,
      life: 3 + rnd() * 6,
      age: 0,
      size: 1.1 + rnd() * 2.4,
      tw: rnd() * TAU,
    });
  }

  _stepParticles(dt) {
    const max = 60 + 360 * this.energy;
    const rate = 4 + 70 * this.energy;
    let n = rate * dt;
    while (n > 0 && this.particles.length < max) {
      if (n >= 1 || Math.random() < n) this._spawnParticle();
      n -= 1;
    }
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  _drawParticles(ctx, W, H, cy, t) {
    ctx.fillStyle = '#ffffff';
    for (const p of this.particles) {
      const k = p.age / p.life;
      const fade = Math.sin(Math.PI * k);
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + p.tw);
      ctx.globalAlpha = clamp(fade * tw, 0, 1);
      const s = p.size;
      ctx.fillRect(p.x * W - s / 2, cy + p.y * H - s / 2, s, s);
    }
  }

  /** Render the current state to an offscreen canvas (for saving/downloading). */
  snapshot(w = 1600, h = 1000, scale = 2) {
    const off = document.createElement('canvas');
    off.width = Math.round(w * scale);
    off.height = Math.round(h * scale);
    const ctx = off.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const savedW = this.W;
    const savedH = this.H;
    this.W = w;
    this.H = h;
    this.draw(ctx, w, h, this.t);
    this.W = savedW;
    this.H = savedH;
    this._computeCurves(savedW, savedH, this.t);
    return off;
  }
}
