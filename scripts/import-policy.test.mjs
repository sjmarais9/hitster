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
import { shouldRefreshCanonicity, permanentReason } from './lib/import-policy.mjs';

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

test('a verdict about the song is permanent', () => {
  // These are facts that will be just as true next hour: Spotify spells her
  // Kesha, and the batch says Ke$ha.
  assert.equal(permanentReason('title and artist do not match'), 'noMatch');
  assert.equal(permanentReason('no search results'), 'noMatch');
  assert.equal(permanentReason('partial match (title exact, artist loose)'), 'partial');
  assert.equal(permanentReason('partial match (title loose, artist exact)'), 'partial');
});

test('a verdict about the moment is never cached', () => {
  // The whole point of the split. Caching a network failure would turn one bad
  // night into a song permanently absent from the pool, which is the same
  // laundering the circuit breaker exists to stop.
  assert.equal(permanentReason('lookup failed: fetch failed'), null);
  assert.equal(permanentReason('lookup failed: 502 Bad Gateway'), null);
  assert.equal(permanentReason('lookup failed: The access token expired'), null);
});

test('an unrecognised reason is treated as transient', () => {
  // Fail open. A reason added later has to be listed deliberately before it can
  // bury a song, rather than burying one the day it is introduced.
  assert.equal(permanentReason('something nobody has written yet'), null);
  assert.equal(permanentReason(undefined), null);
  assert.equal(permanentReason(null), null);
  assert.equal(permanentReason(''), null);
});
