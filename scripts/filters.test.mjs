// Tests for the deck filters: node --test scripts/filters.test.mjs
//
// filters.js is browser code but touches no DOM and no browser API except
// localStorage, which only load/save use. Everything tested here is pure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, describe, DEFAULTS, LEVELS, CROWDS, DECADES, GENRE_GROUPS } from '../src/filters.js';

const song = (over = {}) => ({
  artist: 'A', title: 'B', year: 1995, decade: '1990s',
  genres: ['rock'], familiarity: 'familiar', skew: 'even',
  spotify_uri: 'spotify:track:x', market_checked: 'ZA', ...over,
});

const POOL = [
  song({ title: 'std-even-90s-rock', familiarity: 'standard', skew: 'even' }),
  song({ title: 'fam-adults-80s-pop', familiarity: 'familiar', skew: 'adults', decade: '1980s', genres: ['pop'] }),
  song({ title: 'deep-kids-20s-hiphop', familiarity: 'deep', skew: 'kids', decade: '2020s', genres: ['hip hop'] }),
  song({ title: 'deep-adults-70s-soul', familiarity: 'deep', skew: 'adults', decade: '1970s', genres: ['soul', 'funk'] }),
];

const titles = (result) => result.map((s) => s.title).sort();

test('defaults let everything through', () => {
  assert.equal(apply(POOL, DEFAULTS).length, POOL.length);
});

test('familiarity is cumulative, not exclusive', () => {
  const casual = apply(POOL, { ...DEFAULTS, level: 'casual' });
  assert.deepEqual(titles(casual), ['std-even-90s-rock']);

  const confident = apply(POOL, { ...DEFAULTS, level: 'confident' });
  // Confident must still include the standard song, not just the familiar one.
  assert.deepEqual(titles(confident), ['fam-adults-80s-pop', 'std-even-90s-rock']);

  assert.equal(LEVELS.everything.tiers.length, 3);
});

test('playing with kids drops adults-only songs but keeps even', () => {
  const result = apply(POOL, { ...DEFAULTS, crowd: 'withKids' });
  assert.deepEqual(titles(result), ['deep-kids-20s-hiphop', 'std-even-90s-rock']);
});

test('adults only drops kids songs but keeps even', () => {
  const result = apply(POOL, { ...DEFAULTS, crowd: 'adultsOnly' });
  assert.deepEqual(titles(result), ['deep-adults-70s-soul', 'fam-adults-80s-pop', 'std-even-90s-rock']);
});

test('decade filter', () => {
  const result = apply(POOL, { ...DEFAULTS, decades: ['1970s', '2020s'] });
  assert.deepEqual(titles(result), ['deep-adults-70s-soul', 'deep-kids-20s-hiphop']);
});

test('genre groups match on any of a song\'s genres', () => {
  const soul = apply(POOL, { ...DEFAULTS, genres: ['soul'] });
  assert.deepEqual(titles(soul), ['deep-adults-70s-soul']);
});

test('a song matching no group falls into other', () => {
  const odd = [song({ title: 'odd', genres: ['sea shanty'] })];
  assert.equal(apply(odd, { ...DEFAULTS, genres: ['other'] }).length, 1);
  assert.equal(apply(odd, { ...DEFAULTS, genres: ['rock'] }).length, 0);
});

test('filters combine', () => {
  const result = apply(POOL, { ...DEFAULTS, crowd: 'withKids', decades: ['2020s'] });
  assert.deepEqual(titles(result), ['deep-kids-20s-hiphop']);
});

test('an untagged song stays playable rather than vanishing', () => {
  // The tags are ours and may lag the pool. Only an explicit tag excludes.
  const untagged = [song({ title: 'untagged', familiarity: null, skew: null })];
  assert.equal(apply(untagged, { ...DEFAULTS, level: 'casual', crowd: 'withKids' }).length, 1);
});

test('describe stays quiet when nothing is narrowed', () => {
  assert.equal(describe(DEFAULTS), LEVELS.everything.label);
});

test('describe names what was narrowed', () => {
  const text = describe({ ...DEFAULTS, crowd: 'withKids', decades: ['1990s'] });
  assert.match(text, /playing with kids/);
  assert.match(text, /1990s/);
});

test('every level, crowd, decade and genre key is usable', () => {
  for (const level of Object.keys(LEVELS)) apply(POOL, { ...DEFAULTS, level });
  for (const crowd of Object.keys(CROWDS)) apply(POOL, { ...DEFAULTS, crowd });
  assert.equal(DECADES.length, 8);
  assert.ok(Object.keys(GENRE_GROUPS).includes('other'));
});
