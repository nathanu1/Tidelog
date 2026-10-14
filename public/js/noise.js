import { mulberry32 } from '../../shared/prng.js';

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Seeded 2D value noise with fbm. Deterministic for a given seed. */
export class Noise {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.vals[i] = rnd() * 2 - 1;
  }

  /** @returns value in [-1, 1] */
  value2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const X = xi & 255;
    const Y = yi & 255;
    const p = this.perm;
    const vals = this.vals;
    const a = vals[p[p[X] + Y]];
    const b = vals[p[p[X + 1] + Y]];
    const c = vals[p[p[X] + Y + 1]];
    const d = vals[p[p[X + 1] + Y + 1]];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  fbm2(x, y, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value2(x, y);
      norm += amp;
      x *= lacunarity;
      y *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }
}
