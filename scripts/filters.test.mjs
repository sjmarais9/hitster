// Tests for the deck filters: node --test scripts/filters.test.mjs
//
// Only decade excludes now. Familiarity, skew and genre all shape the odds
// instead, and are tested in scoring.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, describe, DEFAULTS, LEVELS, CROWD, DECADES, GENRE_FAMILIES, familyOf } from '../src/filters.js';

const song = (over = {}) => ({
  artist: 'A', title: 'B', year: 1995, decade: '1990s',
  genres: ['rock'], familiarity: 'familiar', skew: 'even',
  canonicity: 50, spotify_uri: 'spotify:track:x', market_checked: 'ZA', ...over,
});

const POOL = [
  song({ title: 'rock-90s' }),
  song({ title: 'pop-80s', decade: '1980s', genres: ['pop'] }),
  song({ title: 'hiphop-20s', decade: '2020s', genres: ['hip hop'] }),
  song({ title: 'soul-70s', decade: '1970s', genres: ['soul', 'funk'] }),
];

const titles = (result) => result.map((s) => s.title).sort();

test('defaults let everything through', () => {
  assert.equal(apply(POOL, DEFAULTS).length, POOL.length);
});

test('only decade excludes', () => {
  const result = apply(POOL, { ...DEFAULTS, decades: ['1970s', '2020s'] });
  assert.deepEqual(titles(result), ['hiphop-20s', 'soul-70s']);
});

test('the genre mixer never removes songs from the deck', () => {
  // Even muted, a genre stays in the deck; it is the weighting that zeroes it.
  // Keeping the deck whole means the mixer can be changed mid-session without
  // the unplayed set shifting under the player.
  const silent = Object.fromEntries(Object.keys(GENRE_FAMILIES).map((k) => [k, 0]));
  assert.equal(apply(POOL, { ...DEFAULTS, genreLevels: silent }).length, POOL.length);
});

test('familiarity and the crowd slider never remove songs either', () => {
  for (const level of Object.keys(LEVELS)) {
    assert.equal(apply(POOL, { ...DEFAULTS, level }).length, POOL.length);
  }
  for (const crowd of [0, 0.5, 1]) {
    assert.equal(apply(POOL, { ...DEFAULTS, crowd }).length, POOL.length);
  }
});

test('familyOf assigns exactly one family, first match wins', () => {
  assert.equal(familyOf(song({ genres: ['rock'] })), 'rock');
  assert.equal(familyOf(song({ genres: ['hip hop'] })), 'hiphop');
  // Overlapping genres must not produce two families, or the song gets
  // double-weighted and quietly over-drawn.
  assert.equal(familyOf(song({ genres: ['punk', 'pop'] })), 'rock');
  assert.equal(familyOf(song({ genres: ['sea shanty'] })), 'other');
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

test('describe names what was changed', () => {
  const text = describe({
    ...DEFAULTS,
    crowd: 0.9,
    decades: ['1990s'],
    genreLevels: { ...DEFAULTS.genreLevels, folk: 0 },
  });
  assert.match(text, /mostly kids/);
  assert.match(text, /1990s/);
  assert.match(text, /no country/);
});

test('describe reports a moved fader as mixed', () => {
  const text = describe({ ...DEFAULTS, genreLevels: { ...DEFAULTS.genreLevels, rock: 1.6 } });
  assert.match(text, /mixed/);
});

test('a saved selection from before the mixer still works', () => {
  // load() merges over DEFAULTS, but an old saved object carries `genres` and
  // no `genreLevels`. Neither should break anything.
  const legacy = { level: 'casual', crowd: 0.5, decades: [...DECADES], genres: ['rock', 'pop'] };
  assert.equal(apply(POOL, { ...DEFAULTS, ...legacy }).length, POOL.length);
  assert.ok(describe({ ...DEFAULTS, ...legacy }).length > 0);
});

test('every decade key is usable', () => {
  assert.equal(DECADES.length, 8);
  for (const decade of DECADES) apply(POOL, { ...DEFAULTS, decades: [decade] });
});
