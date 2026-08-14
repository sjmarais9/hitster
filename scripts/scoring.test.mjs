// Tests for the sampler: node --test scripts/scoring.test.mjs
//
// Weighted draws are random, so these use a seeded generator and assert on
// distributions over many draws rather than on single picks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scoreOf, weightsFor, pickWeighted, projectedShares, TRUST, LEVELS,
} from '../src/scoring.js';

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

test('the crowd slider still sets the mix once the other controls are moved', () => {
  // The test above cannot fail on the bug this one exists for. Its songs are
  // identical apart from skew, so scoreOf is constant, the other factors are
  // constant, and the normalisation is exact by construction whatever the
  // arithmetic does. The real pool is not like that: the children's songs are
  // recent and well known, the adults' side holds the deep cuts, so every other
  // control correlates with skew. Under the old code, Casual + Balanced gave
  // the children 67% of the night.
  const deck = [
    ...Array.from({ length: 40 }, (_, i) => song({
      title: `adult${i}`, skew: 'adults', familiarity: 'deep', canonicity: 15,
      decade: '1970s', genres: ['rock'],
    })),
    ...Array.from({ length: 10 }, (_, i) => song({
      title: `kid${i}`, skew: 'kids', familiarity: 'standard', canonicity: 92,
      decade: '2010s', genres: ['pop'],
    })),
  ];

  const kidsShare = (options) => {
    const d = distribution(deck, options, 40000);
    return Object.entries(d).filter(([t]) => t.startsWith('kid'))
      .reduce((a, [, v]) => a + v, 0);
  };

  for (const level of Object.keys(LEVELS)) {
    for (const crowd of [0.25, 0.5, 0.75]) {
      const got = kidsShare({ level, crowd });
      assert.ok(Math.abs(got - crowd) < 0.03,
        `${level} at ${crowd}: the children got ${got.toFixed(3)}`);
    }
  }

  // And with the mixers moved, which broke it the same way.
  const withMixers = kidsShare({
    level: 'casual', crowd: 0.5, genreLevels: { rock: 4 }, decadeLevels: { '1970s': 3 },
  });
  assert.ok(Math.abs(withMixers - 0.5) < 0.03,
    `a raised rock fader should not move the crowd balance, kids got ${withMixers}`);
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

test('a deck with nothing eligible draws nothing, rather than dealing the muted', () => {
  // It used to fall back to a uniform draw, which dealt the very songs the
  // player had switched off while their labels read Off. Returning nothing
  // lets the caller say so.
  const deck = [song({ title: 'a', genres: ['rock'] }), song({ title: 'b', genres: ['pop'] })];
  const silent = { rock: 0, pop: 0, other: 0 };
  const weights = weightsFor(deck, { level: 'everything', crowd: 0.5, genreLevels: silent });
  assert.equal(pickWeighted(deck, weights, seeded(11)), null);
});

test('pickWeighted returns nothing for an all-zero weight vector', () => {
  assert.equal(pickWeighted([song({ title: 'a' }), song({ title: 'b' })], [0, 0], seeded(3)), null);
});

test('a partial mute can zero a deck, and it is reported not dealt', () => {
  // The reachable case: one decade, and the only families it contains muted.
  const deck = [
    song({ title: 'a', decade: '1950s', genres: ['rock and roll'] }),
    song({ title: 'b', decade: '1950s', genres: ['rock and roll'] }),
  ];
  const weights = weightsFor(deck, {
    level: 'everything', crowd: 0.5, genreLevels: { rock: 0 },
  });
  assert.equal(weights.reduce((a, b) => a + b, 0), 0);
  assert.equal(pickWeighted(deck, weights, seeded(5)), null);
});

// --- the decade mixer --------------------------------------------------------

// A miniature of the real problem: the generator left the 2000s ahead of the
// 1990s, 24% to 19%, when the table wants the reverse.
const eras = () => [
  ...Array.from({ length: 19 }, (_, i) => song({ title: `n${i}`, decade: '1990s' })),
  ...Array.from({ length: 24 }, (_, i) => song({ title: `o${i}`, decade: '2000s' })),
  ...Array.from({ length: 57 }, (_, i) => song({ title: `x${i}`, decade: '1980s' })),
];

const shareOf = (dist, decade) => Object.entries(dist)
  .filter(([title]) => title.startsWith(decade === '1990s' ? 'n' : 'o'))
  .reduce((a, [, v]) => a + v, 0);

test('a flat decade mixer leaves the pool alone', () => {
  const dist = distribution(eras(), { level: 'everything', crowd: 0.5 });
  assert.ok(Math.abs(shareOf(dist, '1990s') - 0.19) < 0.03,
    `untouched faders must not rebalance anything, 1990s got ${shareOf(dist, '1990s')}`);
});

test('a decade fader moves the mix it is pointed at', () => {
  // The actual fix: nineties up, noughties down, and the pool composition never
  // touched. 19 songs at 1.6x against 24 at 0.7x should put the 1990s ahead.
  const dist = distribution(eras(), {
    level: 'everything',
    crowd: 0.5,
    decadeLevels: { '1990s': 1.6, '2000s': 0.7 },
  });
  assert.ok(shareOf(dist, '1990s') > shareOf(dist, '2000s'),
    `1990s ${shareOf(dist, '1990s')} should now beat 2000s ${shareOf(dist, '2000s')}`);
});

test('a decade fader is not normalised, so it cannot invent songs', () => {
  // Fourteen 1950s songs against a thousand others. A normalised mixer would
  // hand those fourteen an eighth of the night; this one must not.
  const deck = [
    ...Array.from({ length: 14 }, (_, i) => song({ title: `fifties${i}`, decade: '1950s' })),
    ...Array.from({ length: 986 }, (_, i) => song({ title: `rest${i}`, decade: '1990s' })),
  ];
  const dist = distribution(deck, { level: 'everything', crowd: 0.5 });
  const fifties = Object.entries(dist)
    .filter(([t]) => t.startsWith('fifties')).reduce((a, [, v]) => a + v, 0);
  assert.ok(fifties < 0.05, `a flat mixer must mirror the pool, 1950s got ${fifties}`);
});

test('a decade at Off draws nothing', () => {
  const deck = [song({ title: 'a', decade: '1990s' }), song({ title: 'b', decade: '1960s' })];
  const off = distribution(deck, {
    level: 'everything', crowd: 0.5, decadeLevels: { '1960s': 0 },
  }, 20000);
  assert.equal(off.b, 0, 'Off must genuinely exclude, or the label lies');
});

// --- the live mix readout ----------------------------------------------------

test('projectedShares sums to one', () => {
  const shares = projectedShares(eras(), { level: 'casual', crowd: 0.3 }, (s) => s.decade);
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares should account for the whole draw, got ${total}`);
});

test('the readout matches what the deck actually goes on to do', () => {
  // The number on screen is a promise about the next twenty thousand draws.
  // This is the test that stops it becoming decorative.
  const options = {
    level: 'confident',
    crowd: 0.4,
    decadeLevels: { '1990s': 1.6, '2000s': 0.7 },
    genreLevels: { rock: 1.3 },
  };
  const predicted = projectedShares(eras(), options, (s) => s.decade);
  const actual = distribution(eras(), options, 40000);

  for (const decade of ['1990s', '2000s']) {
    const observed = shareOf(actual, decade);
    assert.ok(Math.abs(predicted[decade] - observed) < 0.02,
      `${decade}: predicted ${predicted[decade]}, drew ${observed}`);
  }
});

test('projectedShares survives a deck nothing can be drawn from', () => {
  assert.deepEqual(projectedShares([], {}, (s) => s.decade), {});
});

test('every level is usable', () => {
  const deck = [song({ title: 'x' }), song({ title: 'y', familiarity: 'deep' })];
  for (const level of Object.keys(LEVELS)) {
    const w = weightsFor(deck, { level, crowd: 0.5 });
    assert.equal(w.length, 2);
    assert.ok(w.every((x) => x >= 0 && Number.isFinite(x)), `${level} produced a bad weight`);
  }
});

test('the levels are declared quietest first', () => {
  // The knob lays them out in declaration order, left to right, so a level
  // inserted in the wrong place would wire the control backwards without
  // breaking anything that would show up as an error.
  const ks = Object.values(LEVELS).map((l) => l.k);
  for (let i = 1; i < ks.length; i++) {
    assert.ok(ks[i] < ks[i - 1], `k must fall along the sweep, got ${ks.join(' -> ')}`);
  }
  assert.equal(ks.at(-1), 0, 'the loudest setting must be perfectly flat');
});

test('each level is a step someone would feel, on the pool that ships', () => {
  // This used to build its own deck - canonicity 90/50/10, evenly split - and
  // assert every neighbouring pair at least doubled the deep-cut share. That
  // passed while being false of the real thing: the shipped pool gives 3.8x,
  // 1.8x, 1.6x, so two of the three pairs missed the guarantee the test claimed
  // to protect. A synthetic deck can be made to satisfy any property; the
  // question is whether the pool does.
  const pool = JSON.parse(readFileSync('data/songs.json', 'utf8')).songs;

  const deepShare = (level) => {
    const w = weightsFor(pool, { level, crowd: 0.5 });
    const total = w.reduce((a, b) => a + b, 0);
    return pool.reduce((acc, s, i) => acc + (s.familiarity === 'deep' ? w[i] : 0), 0) / total;
  };

  const keys = Object.keys(LEVELS);
  const shares = keys.map(deepShare);

  for (let i = 1; i < keys.length; i++) {
    const ratio = shares[i] / shares[i - 1];
    // Half as much again, not twice as much. Four levels across a range this
    // wide cannot each double without the ends becoming absurd, and 1.5x is
    // still a step you would notice across a night.
    assert.ok(ratio >= 1.5,
      `${keys[i - 1]} -> ${keys[i]}: ${(shares[i - 1] * 100).toFixed(1)}% to `
      + `${(shares[i] * 100).toFixed(1)}% is only ${ratio.toFixed(2)}x`);
  }

  // And the whole range has to be worth having four settings for.
  assert.ok(shares.at(-1) / shares[0] > 8,
    `end to end is only ${(shares.at(-1) / shares[0]).toFixed(1)}x`);
});
