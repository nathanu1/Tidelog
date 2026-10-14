import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusScore, balanceScore, streakDays, addDays, average } from '../server/lib/metrics.js';

test('focus score weights intensity by duration', () => {
  assert.equal(focusScore([]), 0);
  assert.equal(focusScore([{ duration_min: 60, intensity: 5 }]), 100);
  assert.equal(focusScore([{ duration_min: 60, intensity: 5 }, { duration_min: 60, intensity: 1 }]), 60);
  assert.equal(focusScore([{ duration_min: 0, intensity: 3 }]), 60);
});

test('balance is normalised entropy', () => {
  assert.equal(balanceScore([]), 0);
  assert.equal(balanceScore([{ minutes: 100 }]), 0);
  assert.equal(balanceScore([{ minutes: 50 }, { minutes: 50 }]), 100);
  const skewed = balanceScore([{ minutes: 90 }, { minutes: 10 }]);
  assert.ok(skewed > 0 && skewed < 100);
  assert.equal(balanceScore([{ minutes: 30 }, { minutes: 0 }, { minutes: 30 }, { minutes: 30 }]), 100);
});

test('streak counts back from today, or yesterday when today is empty', () => {
  assert.equal(streakDays(['2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09'], '2026-10-14'), 3);
  assert.equal(streakDays(['2026-10-13', '2026-10-12'], '2026-10-14'), 2);
  assert.equal(streakDays(['2026-10-12'], '2026-10-14'), 0);
  assert.equal(streakDays([], '2026-10-14'), 0);
});

test('addDays crosses month boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('average ignores nulls', () => {
  assert.equal(average([1, null, 3]), 2);
  assert.equal(average([]), null);
});
