// Tests for the sampler: node --test scripts/scoring.test.mjs
//
// Weighted draws are random, so these use a seeded generator and assert on
// distributions over many draws rather than on single picks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOf, weightsFor, pickWeighted, TRUST, LEVELS } from '../src/scoring.js';

const song = (over = {}) => ({
  artist: 'A', title: 'B', year: 1995, decade: '1990s', genres: ['rock'],
  familiarity: 'familiar', skew: 'even', canonicity: 50, ...over,
});

/** Deterministic generator, so a failing test fails the same way twice. */
function seeded(seed = 1) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function distribution(deck, options, draws = 20000, seed = 7) {
  const weights = weightsFor(deck, options);
  const random = seeded(seed);
  const counts = new Map(deck.map((s) => [s.title, 0]));
  for (let i = 0; i < draws; i++) {
    const picked = pickWeighted(deck, weights, random);
    counts.set(picked.title, counts.get(picked.title) + 1);
  }
  return Object.fromEntries([...counts].map(([k, v]) => [k, v / draws]));
}

test('scoreOf blends the tag with canonicity at TRUST', () => {
  // standard tag is 10, canonicity 100 maps to 10, so any blend is 10.
  assert.equal(scoreOf(song({ familiarity: 'standard', canonicity: 100 })), 10);

  // standard tag 10, canonicity 0 maps to 1.
  const expected = TRUST * 10 + (1 - TRUST) * 1;
  assert.ok(Math.abs(scoreOf(song({ familiarity: 'standard', canonicity: 0 })) - expected) < 1e-9);
});

test('an unmeasured song falls back to its tag rather than being diluted', () => {
  assert.equal(scoreOf(song({ familiarity: 'deep', canonicity: null })), 2);
  assert.equal(scoreOf(song({ familiarity: 'standard', canonicity: undefined })), 10);
});

test('canonicity separates songs sharing a tag', () => {
  const known = scoreOf(song({ familiarity: 'deep', canonicity: 99 }));
  const obscure = scoreOf(song({ familiarity: 'deep', canonicity: 5 }));
  assert.ok(known > obscure, 'a globally known deep cut should outscore an obscure one');
  // But it must not escape its tag far enough to outrank a standard song.
  assert.ok(known < scoreOf(song({ familiarity: 'standard', canonicity: 50 })));
});

test('a locally known song outranks a globally known one the family misses', () => {
  // The Vulindlela / September case: this is what TRUST is set to protect.
  const local = scoreOf(song({ familiarity: 'standard', canonicity: 0 }));
  const global = scoreOf(song({ familiarity: 'deep', canonicity: 99 }));
  assert.ok(local > global, `local ${local} should beat global ${global} at TRUST=${TRUST}`);
});

test('casual favours known songs, encyclopaedic does not', () => {
  const deck = [
    song({ title: 'famous', familiarity: 'standard', canonicity: 95 }),
    song({ title: 'obscure', familiarity: 'deep', canonicity: 5 }),
  ];

  const casual = distribution(deck, { level: 'casual', crowd: 0.5 });
  assert.ok(casual.famous > 0.9, `casual should mostly draw the famous song, got ${casual.famous}`);

  const all = distribution(deck, { level: 'everything', crowd: 0.5 });
  assert.ok(Math.abs(all.famous - 0.5) < 0.05, `everything should be near uniform, got ${all.famous}`);
});

test('nothing is ever excluded, only made less likely', () => {
  const deck = [
    song({ title: 'famous', familiarity: 'standard', canonicity: 99 }),
    song({ title: 'obscure', familiarity: 'deep', canonicity: 0 }),
  ];
  const casual = distribution(deck, { level: 'casual', crowd: 0.5 }, 50000);
  assert.ok(casual.obscure > 0, 'a weighted sampler must not have hard exclusions');
});

test('the crowd slider sets the resulting mix, not merely a preference', () => {
  // Lopsided on purpose: 9 adults songs to 1 kids song, like the real pool.
  const deck = [
    ...Array.from({ length: 9 }, (_, i) => song({ title: `adult${i}`, skew: 'adults' })),
    song({ title: 'kid0', skew: 'kids' }),
  ];

  const middle = distribution(deck, { level: 'everything', crowd: 0.5 });
  // Population normalisation should give the single kids song ~half the draws,
  // not the 10% its share of the deck would suggest.
  assert.ok(middle.kid0 > 0.4 && middle.kid0 < 0.6,
    `balanced slider should split the draw evenly, kids got ${middle.kid0}`);

  const adultsEnd = distribution(deck, { level: 'everything', crowd: 0 });
  assert.ok(adultsEnd.kid0 < 0.02, `adults end should almost never draw kids, got ${adultsEnd.kid0}`);

  const kidsEnd = distribution(deck, { level: 'everything', crowd: 1 });
  assert.ok(kidsEnd.kid0 > 0.95, `kids end should almost always draw kids, got ${kidsEnd.kid0}`);
});

test('the two dimensions compose without one swamping the other', () => {
  const deck = [
    song({ title: 'famous-adult', familiarity: 'standard', canonicity: 95, skew: 'adults' }),
    song({ title: 'obscure-kid', familiarity: 'deep', canonicity: 5, skew: 'kids' }),
  ];
  // Casual pulls toward the famous song, the kids slider pulls the other way.
  const both = distribution(deck, { level: 'casual', crowd: 1 });
  assert.ok(both['obscure-kid'] > 0.5,
    `a hard kids setting should still surface the kids song, got ${both['obscure-kid']}`);
});

test('a flat mixer draws the pool exactly as it is', () => {
  // Lopsided like the real pool: 9 rock to 1 African. Untouched faders must not
  // rebalance that, or 12 real African songs would repeat all night.
  const deck = [
    ...Array.from({ length: 9 }, (_, i) => song({ title: `rock${i}`, genres: ['rock'] })),
    song({ title: 'afro0', genres: ['amapiano'] }),
  ];

  const flat = distribution(deck, { level: 'everything', crowd: 0.5 });
  assert.ok(Math.abs(flat.afro0 - 0.1) < 0.03,
    `flat mixer should mirror the pool's 1-in-10, African got ${flat.afro0}`);
});

test('raising a fader raises that family proportionally', () => {
  const deck = [
    ...Array.from({ length: 9 }, (_, i) => song({ title: `rock${i}`, genres: ['rock'] })),
    song({ title: 'afro0', genres: ['amapiano'] }),
  ];

  // Each African song becomes 5x as likely; with one of ten songs that takes it
  // from 1/10 to 5/14, which is a real shift without pretending the pool is
  // bigger than it is.
  const boosted = distribution(deck, {
    level: 'everything', crowd: 0.5, genreLevels: { rock: 1, african: 5 },
  });
  assert.ok(boosted.afro0 > 0.28 && boosted.afro0 < 0.42,
    `a 5x fader should give roughly 5/14 of draws, got ${boosted.afro0}`);
});

test('a fader only changes likelihood until it reaches Off', () => {
  const deck = [
    song({ title: 'rock', genres: ['rock'] }),
    song({ title: 'folk', genres: ['country'] }),
  ];

  // Turned down but not off: rarer, never impossible. This is the property the
  // whole weighted design exists for.
  const low = distribution(deck, { level: 'everything', crowd: 0.5, genreLevels: { folk: 0.1 } }, 50000);
  assert.ok(low.folk > 0, 'a turned-down genre must still appear');
  assert.ok(low.folk < 0.2, `and appear rarely, got ${low.folk}`);

  // Off means off, deliberately.
  const off = distribution(deck, { level: 'everything', crowd: 0.5, genreLevels: { folk: 0 } }, 20000);
  assert.equal(off.folk, 0, 'Off must genuinely exclude, or the label lies');
});

test('muting every genre falls back to uniform rather than drawing nothing', () => {
  const deck = [song({ title: 'a', genres: ['rock'] }), song({ title: 'b', genres: ['pop'] })];
  const silent = { rock: 0, pop: 0, other: 0 };
  const weights = weightsFor(deck, { level: 'everything', crowd: 0.5, genreLevels: silent });
  const picked = pickWeighted(deck, weights, seeded(11));
  assert.ok(picked, 'an all-muted mixer must not leave the game unable to draw');
});

test('pickWeighted survives an all-zero weight vector', () => {
  const deck = [song({ title: 'a' }), song({ title: 'b' })];
  const picked = pickWeighted(deck, [0, 0], seeded(3));
  assert.ok(picked, 'should fall back to uniform rather than returning nothing');
});

test('every level is usable', () => {
  const deck = [song({ title: 'x' }), song({ title: 'y', familiarity: 'deep' })];
  for (const level of Object.keys(LEVELS)) {
    const w = weightsFor(deck, { level, crowd: 0.5 });
    assert.equal(w.length, 2);
    assert.ok(w.every((x) => x >= 0 && Number.isFinite(x)), `${level} produced a bad weight`);
  }
});
