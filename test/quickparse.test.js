import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, inferCategory, matchCategory } from '../shared/quickparse.js';

const cats = [
  { slug: 'work', name: 'Work' }, { slug: 'learning', name: 'Learning' }, { slug: 'exercise', name: 'Exercise' },
  { slug: 'creative', name: 'Creative' }, { slug: 'social', name: 'Social' }, { slug: 'rest', name: 'Rest' }, { slug: 'admin', name: 'Admin' },
];

test('parses a full line', () => {
  const p = parseQuick('45m deep work on the renderer @work #focus #art !4 ~5', cats);
  assert.deepEqual(p, { title: 'deep work on the renderer', duration_min: 45, category: 'work', tags: ['focus', 'art'], intensity: 4, mood: 5 });
});

test('duration formats', () => {
  assert.equal(parseQuick('1h run', cats).duration_min, 60);
  assert.equal(parseQuick('1h30m run', cats).duration_min, 90);
  assert.equal(parseQuick('1.5h run', cats).duration_min, 90);
  assert.equal(parseQuick('run 90min', cats).duration_min, 90);
  assert.equal(parseQuick('run 20 minutes', cats).duration_min, 20);
  assert.equal(parseQuick('run', cats).duration_min, null);
});

test('does not eat words that merely end in m', () => {
  const p = parseQuick('album listening 30m', cats);
  assert.equal(p.title, 'album listening');
  assert.equal(p.duration_min, 30);
});

test('category prefix matching and names', () => {
  assert.equal(parseQuick('reading @lea', cats).category, 'learning');
  assert.equal(parseQuick('reading @Learning', cats).category, 'learning');
  assert.equal(matchCategory('exer', cats), 'exercise');
});

test('infers category from keywords', () => {
  assert.equal(inferCategory('Morning run with the dog', cats), 'exercise');
  assert.equal(inferCategory('Dinner with friends', cats), 'social');
  assert.equal(inferCategory('Guitar practice', cats), 'creative');
  assert.equal(inferCategory('Code review and standup', cats), 'work');
  assert.equal(inferCategory('xyzzy', cats), null);
});

test('tags are lowercased and de-duplicated', () => {
  assert.deepEqual(parseQuick('walk #Outdoors #outdoors #Dog', cats).tags, ['outdoors', 'dog']);
});

test('ignores out-of-range intensity and mood tokens', () => {
  const p = parseQuick('read !9 ~0', cats);
  assert.equal(p.intensity, null);
  assert.equal(p.mood, null);
  assert.equal(p.title, 'read !9 ~0');
});

test('handles garbage input', () => {
  assert.equal(parseQuick(undefined, cats).title, '');
  assert.equal(parseQuick('   ', cats).title, '');
});
