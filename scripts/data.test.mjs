// Invariants over the real data: node --test scripts/data.test.mjs
//
// Every serious bug in this project has been in the pipeline rather than the
// sampler, and every one of them was invisible to the existing tests because
// those test logic against fixtures. These test the actual files.
//
// The three that have bitten, and would now fail here loudly:
//
//   the import dropped `canonicity` from every record it wrote
//   apply-canonicity ranked unmeasured songs as zeros and inverted the tiers
//   the skew seed put nothing before 2000 on the children's side
//
// This file is also the gate the daily import runs before it publishes, so a
// corrupt pool cannot reach the phone even if something new goes wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { readSongs } from './lib/songs-file.mjs';

const POOL = 'data/songs.json';
const BATCHES = [
  'data/batch-002.seed.json',
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

const FAMILIARITY = ['standard', 'familiar', 'deep'];
const SKEW = ['adults', 'even', 'kids'];
const EARLIEST = 1950;
const LATEST = new Date().getFullYear();

const load = async (file) => (await readSongs(file, { songs: [] })).songs ?? [];

const pool = await load(POOL);
const batches = await Promise.all(BATCHES.map(async (f) => [f, await load(f)]));
const corpus = [pool, ...batches.map(([, s]) => s)].flat();

/** Reports up to `n` offenders, so a failure names names instead of a count. */
function sample(bad, n = 5) {
  return bad.slice(0, n).map((s) => `${s.artist} - ${s.title}`).join('; ')
    + (bad.length > n ? ` (and ${bad.length - n} more)` : '');
}

// --- the pool is what the app actually downloads -----------------------------

test('the pool is not empty', () => {
  assert.ok(pool.length > 0, 'data/songs.json has no songs');
});

test('every playable song has a verified URI', () => {
  // The one rule PROJECT_SPEC states outright: a song without a verified URI
  // must never enter the playable pool.
  const bad = pool.filter((s) => !s.spotify_uri || !s.market_checked);
  assert.equal(bad.length, 0, `missing uri or market: ${sample(bad)}`);
});

test('every playable song carries a canonicity score', () => {
  // This is the one that would have caught the import silently dropping the
  // field from 687 songs, which left them scored on the tag alone.
  const bad = pool.filter((s) => s.canonicity === null || s.canonicity === undefined);
  assert.equal(bad.length, 0, `no canonicity: ${sample(bad)}`);
});

test('the pool has no duplicates', () => {
  const seen = new Set();
  const bad = pool.filter((s) => {
    const key = `${s.artist}|${s.title}`.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  assert.equal(bad.length, 0, `duplicated: ${sample(bad)}`);
});

// --- every song, everywhere --------------------------------------------------

test('every song is fully formed', () => {
  const bad = corpus.filter((s) =>
    !s.artist?.trim() || !s.title?.trim() || !Array.isArray(s.genres) || s.genres.length === 0);
  assert.equal(bad.length, 0, `missing artist, title or genres: ${sample(bad)}`);
});

test('every year is plausible and matches its decade', () => {
  const bad = corpus.filter((s) =>
    !Number.isInteger(s.year)
    || s.year < EARLIEST || s.year > LATEST
    || `${Math.floor(s.year / 10) * 10}s` !== s.decade);
  assert.equal(bad.length, 0, `year or decade wrong: ${sample(bad)}`);
});

test('every tag is one of the values the sampler knows', () => {
  // An unknown value does not throw anywhere - scoreOf falls back and skew
  // defaults to even - so a typo would silently mis-weight a song forever.
  const bad = corpus.filter((s) =>
    !FAMILIARITY.includes(s.familiarity) || !SKEW.includes(s.skew));
  assert.equal(bad.length, 0, `unknown familiarity or skew: ${sample(bad)}`);
});

test('every canonicity is a percentile', () => {
  const bad = corpus.filter((s) => s.canonicity !== null && s.canonicity !== undefined
    && (!Number.isInteger(s.canonicity) || s.canonicity < 0 || s.canonicity > 100));
  assert.equal(bad.length, 0, `canonicity out of range: ${sample(bad)}`);
});

// --- the measurement still means what the sampler blends it as ---------------

test('canonicity falls across the familiarity tiers', () => {
  // The check that apply-canonicity printed and then ignored. Deliberately weak:
  // the two may disagree song by song, which is the whole reason TRUST exists.
  // But if the medians stop falling, the number has stopped tracking how well
  // known a song is, and every draw is being weighted on noise.
  const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const tier = Object.fromEntries(FAMILIARITY.map((t) => [t,
    corpus.filter((s) => s.familiarity === t && s.canonicity != null).map((s) => s.canonicity)]));

  for (const t of FAMILIARITY) assert.ok(tier[t].length > 50, `too few ${t} songs to judge`);

  const [standard, familiar, deep] = FAMILIARITY.map((t) => median(tier[t]));
  assert.ok(standard > familiar,
    `standard should outrank familiar, got ${standard} vs ${familiar}`);
  assert.ok(familiar > deep,
    `familiar should outrank deep, got ${familiar} vs ${deep}`);
});

test('the children can be dealt music from before they were born', () => {
  // The skew seed once put nothing at all before 2000 on their side, which made
  // a balanced crowd mean a night of the last fifteen years. Not a rule about
  // any one song - a rule about the shape of the pool.
  const shareable = corpus.filter((s) => s.skew !== 'adults');
  const old = shareable.filter((s) => s.year < 2000);
  assert.ok(old.length / shareable.length > 0.15,
    `only ${((old.length / shareable.length) * 100).toFixed(1)}% of the children's side predates 2000`);
});

// --- what ships over mobile data ---------------------------------------------

test('the pool stays small enough to download at a party', () => {
  const bytes = statSync(POOL).size;
  const each = bytes / pool.length;

  // Per song rather than total, because the total is meant to grow. This
  // catches a field being added to every record, which is how a pool goes from
  // three megabytes to six without anyone deciding to.
  assert.ok(each < 340, `${each.toFixed(0)} bytes/song; a full pool would be ${(each * 10927 / 1024 / 1024).toFixed(1)} MB`);
});
