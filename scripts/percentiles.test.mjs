// Tests for the ranking behind canonicity:
//   node --test scripts/percentiles.test.mjs
//
// This is where the worst bug in the project lived. Nothing threw, nothing
// looked wrong in isolation, and every score in the pool came out inverted -
// because "we never asked" and "the answer is zero" were being treated as the
// same thing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { percentiles, blend } from './lib/percentiles.mjs';

const song = (id, decade, value) => ({ id, decade, value });
const by = (s) => s.value;

test('the least popular song of its decade is 0 and the most is 100', () => {
  const p = percentiles([
    song('a', '1990s', 5), song('b', '1990s', 50), song('c', '1990s', 900),
  ], by);
  assert.equal(p.get('a'), 0);
  assert.equal(p.get('c'), 100);
  assert.ok(p.get('b') > 0 && p.get('b') < 100);
});

test('rank is by position, not by distance', () => {
  // One runaway hit must not crush everything below it into the same score.
  const p = percentiles([
    song('a', '1990s', 1), song('b', '1990s', 2),
    song('c', '1990s', 3), song('d', '1990s', 1_000_000),
  ], by);
  // Compared loosely: thirds are not exactly representable, and the point here
  // is the spacing rather than the last bit of the mantissa.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(p.get('a'), 0);
  near(p.get('b'), 100 / 3);
  near(p.get('c'), 200 / 3);
  near(p.get('d'), 100);
});

test('each decade is ranked against itself', () => {
  // The whole reason this is per-decade: a 1967 song with 20 playlist
  // appearances is a giant of its era, a 2015 song with 20 is nothing.
  const p = percentiles([
    song('old-low', '1960s', 5), song('old-high', '1960s', 20),
    song('new-low', '2010s', 400), song('new-high', '2010s', 9000),
  ], by);
  assert.equal(p.get('old-high'), 100, 'top of the 1960s, on 20 appearances');
  assert.equal(p.get('new-low'), 0, 'bottom of the 2010s, on 400');
});

test('a song with nothing to be ranked against gets no percentile', () => {
  // It used to get 0 - the most obscure score there is - purely for being alone
  // in its decade. That is the unmeasured-as-zero mistake again, one decade at a
  // time, and it happens for real whenever a thin source has fetched only one
  // song from some era.
  const p = percentiles([song('only', '1950s', 3)], by);
  assert.equal(p.get('only'), undefined);
  assert.ok(!Number.isNaN(p.get('only')));
});

test('two songs in a decade is enough to rank them', () => {
  const p = percentiles([song('a', '1950s', 1), song('b', '1950s', 2)], by);
  assert.equal(p.get('a'), 0);
  assert.equal(p.get('b'), 100);
});

test('an unmeasured song is left out of the ranking, not ranked last', () => {
  // The bug, stated as a test. If null is treated as zero, `unknown` lands at
  // the bottom of its decade and drags every measured song up past it.
  const p = percentiles([
    song('low', '1990s', 1), song('high', '1990s', 100), song('unknown', '1990s', null),
  ], by);

  assert.equal(p.get('unknown'), undefined, 'unmeasured songs get no percentile');
  assert.equal(p.get('low'), 0, 'the ranking is unchanged by what it cannot see');
  assert.equal(p.get('high'), 100);
});

test('undefined counts as unmeasured too', () => {
  const p = percentiles([song('a', '1990s', 1), song('b', '1990s', undefined)], by);
  assert.equal(p.get('b'), undefined);
});

test('a genuine zero is ranked, because zero is an answer', () => {
  // Deezer's absence means the song appeared on no playlist we swept, which is
  // a finding. It has to rank, at the bottom.
  const p = percentiles([
    song('none', '1990s', 0), song('some', '1990s', 10), song('lots', '1990s', 90),
  ], by);
  assert.equal(p.get('none'), 0);
  assert.equal(p.get('lots'), 100);
});

// --- blending ----------------------------------------------------------------

test('two sources that agree give that score', () => {
  const a = new Map([['x', 80]]);
  const b = new Map([['x', 80]]);
  assert.equal(blend([a, b], 'x'), 80);
});

test('a source with nothing to say does not drag the score down', () => {
  // The arithmetic that inverted the pool: 80 and "no idea" is 80, not 40.
  const measured = new Map([['x', 80]]);
  const silent = new Map();
  assert.equal(blend([measured, silent], 'x'), 80);
});

test('a song no source can rank has no score at all', () => {
  assert.equal(blend([new Map(), new Map()], 'x'), null);
});

test('scores are whole numbers, since that is what ships', () => {
  const a = new Map([['x', 33]]);
  const b = new Map([['x', 34]]);
  const score = blend([a, b], 'x');
  assert.ok(Number.isInteger(score), `got ${score}`);
});

test('a thinly covered source cannot reorder a well covered one', () => {
  // The realistic shape of the failure: one source covers everything, the other
  // covers a seventh of it. The scores must still follow the source that can
  // see the whole corpus.
  const songs = Array.from({ length: 70 }, (_, i) => song(`s${i}`, '1990s', i));
  const wide = percentiles(songs, by);

  // Only the last ten were ever fetched from the thin source, and they happen
  // to be the popular ones - which is exactly how the real index was built.
  const thin = percentiles(
    songs.map((s, i) => ({ ...s, value: i >= 60 ? i : null })), by);

  const bottom = blend([wide, thin], 's0');
  const top = blend([wide, thin], 's69');
  assert.ok(top > bottom, `top ${top} should still outrank bottom ${bottom}`);

  // And a song the thin source never saw keeps the wide source's opinion whole.
  assert.equal(blend([wide, thin], 's30'), Math.round(wide.get('s30')));
});
