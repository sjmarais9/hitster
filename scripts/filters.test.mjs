// Tests for the deck filters: node --test scripts/filters.test.mjs
//
// Since weighted sampling landed, familiarity and skew no longer belong here -
// they shape the odds in scoring.js rather than deciding eligibility. What is
// left is what genuinely excludes: decade and genre.

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, describe, DEFAULTS, LEVELS, CROWD, DECADES, GENRE_GROUPS } from '../src/filters.js';

const song = (over = {}) => ({
  artist: 'A', title: 'B', year: 1995, decade: '1990s',
  genres: ['rock'], familiarity: 'familiar', skew: 'even',
  canonicity: 50, spotify_uri: 'spotify:track:x', market_checked: 'ZA', ...over,
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

test('familiarity no longer excludes anything', () => {
  // It weights the draw instead. A casual game still has every song in its
  // deck; the obscure ones simply almost never come up.
  for (const level of Object.keys(LEVELS)) {
    assert.equal(apply(POOL, { ...DEFAULTS, level }).length, POOL.length);
  }
});

test('the crowd slider no longer excludes anything', () => {
  for (const crowd of [0, 0.25, 0.5, 0.75, 1]) {
    assert.equal(apply(POOL, { ...DEFAULTS, crowd }).length, POOL.length,
      `crowd ${crowd} should not remove songs from the deck`);
  }
});

test('decade filter excludes', () => {
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

test('decade and genre combine', () => {
  const result = apply(POOL, { ...DEFAULTS, decades: ['2020s'], genres: ['hiphop'] });
  assert.deepEqual(titles(result), ['deep-kids-20s-hiphop']);
});

test('crowd labels cover the whole range', () => {
  assert.equal(CROWD.labelFor(0), 'Adults only');
  assert.equal(CROWD.labelFor(0.5), 'Balanced');
  assert.equal(CROWD.labelFor(1), 'Kids only');
  assert.equal(CROWD.labelFor(0.2), 'Mostly adults');
  assert.equal(CROWD.labelFor(0.8), 'Mostly kids');
});

test('describe stays quiet when nothing is narrowed', () => {
  assert.equal(describe(DEFAULTS), LEVELS.everything.label);
});

test('describe names what was narrowed', () => {
  const text = describe({ ...DEFAULTS, crowd: 0.9, decades: ['1990s'] });
  assert.match(text, /mostly kids/);
  assert.match(text, /1990s/);
});

test('a saved selection missing a newer key still works', () => {
  // load() merges over DEFAULTS; this is the shape that produces.
  const legacy = { ...DEFAULTS, crowd: undefined };
  assert.equal(apply(POOL, legacy).length, POOL.length);
  assert.ok(describe(legacy).length > 0);
});

test('every decade and genre key is usable', () => {
  assert.equal(DECADES.length, 8);
  assert.ok(Object.keys(GENRE_GROUPS).includes('other'));
  for (const decade of DECADES) apply(POOL, { ...DEFAULTS, decades: [decade] });
  for (const genre of Object.keys(GENRE_GROUPS)) apply(POOL, { ...DEFAULTS, genres: [genre] });
});
