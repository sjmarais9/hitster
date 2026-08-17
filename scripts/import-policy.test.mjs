// The decision that never fired.
//
// canonicity was refreshed only when the import did NOT hit the quota, which
// sounds cautious and is the opposite of correct: the quota is how every
// productive run ends, so the refresh ran exclusively on runs where no song had
// landed. Nineteen importing runs, zero refreshes, and nothing anywhere said so
// - the scores simply drifted further from the corpus every day.
//
// Nothing threw, no test failed, and the only visible symptom was a number
// nobody was looking at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshCanonicity } from './lib/import-policy.mjs';

test('a run stopped by the quota still refreshes, because songs landed', () => {
  // The exact case that never fired. Every productive run looks like this:
  // the backlog is 7,300 songs against about 660 a day, so the quota stops it
  // and everything resolved has already been checkpointed.
  assert.equal(shouldRefreshCanonicity({ failed: false, poolBefore: 2979, poolAfter: 3640 }), true);
});

test('a run that landed nothing does not refresh', () => {
  // The lockout case, which fires hourly and must stay cheap and silent.
  assert.equal(shouldRefreshCanonicity({ failed: false, poolBefore: 3640, poolAfter: 3640 }), false);
});

test('a hard failure never refreshes', () => {
  // A run that died somewhere unknown may have left the pool half written, and
  // re-ranking the corpus on top of that is how a bad score reaches the phone.
  assert.equal(shouldRefreshCanonicity({ failed: true, poolBefore: 2979, poolAfter: 3640 }), false);
  assert.equal(shouldRefreshCanonicity({ failed: true, poolBefore: 2979, poolAfter: 2979 }), false);
});

test('a pool that somehow shrank does not refresh', () => {
  // Not expected, and that is the reason to be explicit: songs only ever leave
  // the pool when something has gone wrong, and re-ranking would bake it in.
  assert.equal(shouldRefreshCanonicity({ failed: false, poolBefore: 3640, poolAfter: 2979 }), false);
});
