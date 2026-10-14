#!/usr/bin/env node
// Populates ~14 days of plausible activity so the artwork has something to say.
import { pool, query } from '../server/db.js';
import { runMigrations } from '../server/migrate.js';
import { mulberry32 } from '../shared/prng.js';

const rand = mulberry32(Number(process.env.SEED_RANDOM || 20261014));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const chance = (p) => rand() < p;
const DAYS = Number(process.env.SEED_DAYS || 14);

const TITLES = {
  work: ['Deep work on the renderer', 'Sprint planning', 'Code review', 'Writing the API spec', 'Pairing session', 'Debugging the migration', 'Inbox zero', 'Design sync', 'Shipping the release', 'Customer call'],
  learning: ['Reading: Designing Data-Intensive Applications', 'Course: generative art with canvas', 'Studying Postgres internals', 'Flashcards', 'Watching a systems lecture', 'Paper: diffusion models'],
  exercise: ['Morning run', 'Gym: push day', 'Yoga', 'Long walk', 'Bike ride', 'Climbing', 'Swim'],
  creative: ['Sketching wave forms', 'Writing in the journal', 'Guitar practice', 'Editing photos', 'Working on the short story', 'Synth jam'],
  social: ['Dinner with friends', 'Coffee with Sam', 'Family call', 'Board game night', 'Lunch with the team'],
  rest: ['Afternoon nap', 'Meditation', 'Podcast on the couch', 'Movie night', 'Reading in bed', 'Slow breakfast'],
  admin: ['Groceries', 'Cooking dinner', 'Laundry', 'Paying bills', 'Cleaning the flat', 'Commute', 'Doctor appointment'],
};
const TAGS = {
  work: ['focus', 'meetings', 'backend', 'frontend', 'writing'],
  learning: ['books', 'course', 'notes'],
  exercise: ['cardio', 'strength', 'outdoors'],
  creative: ['art', 'music', 'writing'],
  social: ['friends', 'family'],
  rest: ['recovery', 'mindful'],
  admin: ['home', 'errands'],
};

function plan(dayOffset, now) {
  const items = [];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - dayOffset);
  const at = (h) => new Date(day.getTime() + h * 3_600_000);
  const weekend = [0, 6].includes(day.getDay());

  const add = (slug, hour, min, intensity, moodBias = 0) => {
    const started = at(hour);
    if (started.getTime() + min * 60_000 > now.getTime()) return;
    const mood = Math.max(1, Math.min(5, Math.round(between(2.6, 4.6) + moodBias)));
    items.push({
      slug,
      title: pick(TITLES[slug]),
      duration_min: Math.round(min),
      intensity: Math.max(1, Math.min(5, Math.round(intensity))),
      mood,
      tags: chance(0.7) ? [pick(TAGS[slug])] : [],
      started_at: started,
    });
  };

  if (chance(weekend ? 0.55 : 0.45)) add('exercise', between(6.5, 8.5), between(30, 65), between(3.5, 5), 0.4);
  add('admin', between(8, 9), between(10, 30), between(1.5, 3));
  if (!weekend) {
    add('work', between(9, 10), between(60, 130), between(3.5, 5));
    add('work', between(11.5, 13), between(30, 75), between(2.5, 4));
    if (chance(0.6)) add('social', between(12.5, 13.5), between(30, 60), between(1.5, 3), 0.3);
    add('work', between(14, 15.5), between(60, 120), between(3, 5));
    if (chance(0.5)) add('work', between(16.5, 17.5), between(30, 60), between(2, 4));
  } else {
    if (chance(0.5)) add('creative', between(10, 12), between(60, 120), between(3, 5), 0.5);
    if (chance(0.6)) add('social', between(12, 14), between(60, 150), between(2, 4), 0.6);
    if (chance(0.4)) add('admin', between(15, 17), between(30, 90), between(2, 3.5));
  }
  if (chance(0.55)) add('learning', between(18, 19.5), between(30, 75), between(3, 4.5), 0.2);
  if (chance(0.45)) add('creative', between(19.5, 21), between(40, 90), between(3, 5), 0.5);
  if (chance(0.35)) add('social', between(19, 20.5), between(60, 150), between(2, 4), 0.6);
  add('rest', between(21, 22.5), between(25, 60), between(1, 2), 0.3);
  return items;
}

try {
  await runMigrations({ log: () => {} });
  const { rows: cats } = await query('SELECT id, slug FROM categories');
  const idOf = Object.fromEntries(cats.map((c) => [c.slug, c.id]));
  const now = new Date();
  const items = [];
  for (let d = DAYS - 1; d >= 0; d--) items.push(...plan(d, now));
  items.sort((a, b) => a.started_at - b.started_at);

  const values = [];
  const params = [];
  for (const it of items) {
    const base = params.length;
    params.push(idOf[it.slug], it.title, it.duration_min, it.intensity, it.mood, it.tags, it.started_at);
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'seed', $${base + 7})`);
  }
  if (process.argv.includes('--fresh')) await query(`DELETE FROM activities WHERE source = 'seed'`);
  await query(
    `INSERT INTO activities (category_id, title, duration_min, intensity, mood, tags, source, started_at) VALUES ${values.join(',')}`,
    params,
  );
  console.log(`[seed] inserted ${items.length} activities over ${DAYS} days`);
} catch (err) {
  console.error('[seed] failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
