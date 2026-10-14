import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayers, artSeed } from '../server/lib/art.js';
import { resampleEnvelope } from '../public/js/art.js';
import { hashString, mulberry32, hash2 } from '../shared/prng.js';

const cats = [
  { id: 1, slug: 'work', name: 'Work', color: '#3B7BE0', sort_order: 10 },
  { id: 2, slug: 'rest', name: 'Rest', color: '#A6DBEA', sort_order: 60 },
];

test('buildLayers normalises to the global maximum and keeps category order', () => {
  const rows = [
    { i: 0, category_id: 2, minutes: 15, weighted: 15, entries: 1 },
    { i: 1, category_id: 1, minutes: 30, weighted: 150, entries: 2 },
    { i: 2, category_id: 1, minutes: 15, weighted: 60, entries: 1 },
  ];
  const layers = buildLayers(rows, cats, 4, 30);
  assert.deepEqual(layers.map((l) => l.slug), ['work', 'rest']);
  const work = layers[0];
  assert.deepEqual(work.env, [0, 1, 0.5, 0]);
  assert.equal(work.inten[1], 1);
  assert.equal(work.inten[2], 0.8);
  assert.equal(work.minutes, 45);
  assert.deepEqual(layers[1].env, [0.5, 0, 0, 0]);
});

test('buildLayers ignores unknown categories and handles no rows', () => {
  assert.deepEqual(buildLayers([], cats, 4, 30), []);
  assert.deepEqual(buildLayers([{ i: 0, category_id: 99, minutes: 5, weighted: 5, entries: 1 }], cats, 4, 30), []);
});

test('seed is deterministic for identical data', () => {
  const a = artSeed('24h', { latestId: 10, count: 3, minutes: 120 });
  const b = artSeed('24h', { latestId: 10, count: 3, minutes: 120 });
  const c = artSeed('7d', { latestId: 10, count: 3, minutes: 120 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(hashString('abc'), hashString('abc'));
});

test('resampleEnvelope keeps the peak where the data is and never goes negative', () => {
  const env = new Array(48).fill(0);
  env[24] = 1;
  const out = resampleEnvelope(env, 240);
  assert.equal(out.length, 240);
  let maxI = 0;
  for (let i = 1; i < out.length; i++) if (out[i] > out[maxI]) maxI = i;
  assert.ok(Math.abs(maxI - 120) <= 3, `peak at ${maxI}`);
  assert.ok(out.every((v) => v >= 0));
  assert.ok(out[0] < 0.01 && out[239] < 0.01);
  assert.equal(resampleEnvelope([], 10).length, 10);
});

test('prng helpers are deterministic', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.equal(a(), b());
  assert.equal(hash2(3, 4, 5), hash2(3, 4, 5));
  assert.ok(hash2(3, 4, 5) >= 0 && hash2(3, 4, 5) < 1);
});
