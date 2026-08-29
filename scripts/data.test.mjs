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
//   a re-seed overwrote seven tags the household had corrected by hand
//
// This file is also the gate the daily import runs before it publishes, so a
// corrupt pool cannot reach the phone even if something new goes wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { readSongs } from './lib/songs-file.mjs';
import { verdictFor, verifiedYearFor } from './lib/reviewed.mjs';
import { familiarityFor } from './lib/seeds.mjs';
import { isExcluded } from './lib/excluded.mjs';

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

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Median canonicity per familiarity tier, over whichever songs are given. */
function tiers(songs) {
  return FAMILIARITY.map((t) =>
    median(songs.filter((s) => s.familiarity === t && s.canonicity != null)
      .map((s) => s.canonicity)));
}

// The check that apply-canonicity printed and then ignored. Deliberately weak:
// the two may disagree song by song, which is the whole reason TRUST exists.
// But if the medians stop falling, the number has stopped tracking how well
// known a song is, and every draw is being weighted on noise.
//
// Run over the pool AND the corpus, because over the corpus alone it was barely
// a check at all. The pool is 1,649 songs of 11,000, so corrupting only the file
// the app downloads moves the corpus medians by a few points and passes:
// zeroing every pool score gave 82/53/19, inverting every one gave 82/54/25,
// and both sailed through. That is precisely the bug this exists to catch,
// arriving through the import instead of the scorer.
for (const [what, songs] of [['the playable pool', () => pool], ['the whole corpus', () => corpus]]) {
  test(`canonicity falls across the familiarity tiers, in ${what}`, () => {
    const set = songs();
    const counts = FAMILIARITY.map((t) => set.filter((s) => s.familiarity === t).length);
    for (const [i, t] of FAMILIARITY.entries()) {
      assert.ok(counts[i] > 50, `too few ${t} songs in ${what} to judge`);
    }

    const [standard, familiar, deep] = tiers(set);
    assert.ok(standard > familiar,
      `${what}: standard should outrank familiar, got ${standard} vs ${familiar}`);
    assert.ok(familiar > deep,
      `${what}: familiar should outrank deep, got ${familiar} vs ${deep}`);
  });
}

test('the children can be dealt music from before they were born', () => {
  // The skew seed once put nothing at all before 2000 on their side, which made
  // a balanced crowd mean a night of the last fifteen years. Not a rule about
  // any one song - a rule about the shape of the pool.
  const shareable = corpus.filter((s) => s.skew !== 'adults');
  const old = shareable.filter((s) => s.year < 2000);
  assert.ok(old.length / shareable.length > 0.15,
    `only ${((old.length / shareable.length) * 100).toFixed(1)}% of the children's side predates 2000`);
});

test('no rule has overwritten a judgement the household made', () => {
  // The fourth bug of the kind this file exists for, and the first that was
  // caused by a fix rather than found by one. Raising SHARED to 80 was right,
  // and re-seeding the data to match it was right, but the re-seed ran over
  // every song instead of only the ones the threshold moved - and flipped seven
  // songs the review that same morning had corrected by hand back to what the
  // machine thought. Both changes correct, the seam between them not.
  //
  // Nothing threw, because every value it wrote was a legal one. This is the
  // only thing that would have noticed.
  const wrong = [];
  for (const song of corpus) {
    const verdict = verdictFor(song);
    if (!verdict) continue;
    if (song.skew !== verdict.skew) {
      wrong.push(`${song.artist} - ${song.title}: skew is ${song.skew}, the review said ${verdict.skew}`);
    }
    if (verdict.familiarity && song.familiarity !== verdict.familiarity) {
      wrong.push(`${song.artist} - ${song.title}: familiarity is ${song.familiarity}, the review said ${verdict.familiarity}`);
    }
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`);
});

test('nothing popular somewhere else has walked back into the pool', () => {
  // These scored well and were tagged `standard` - Casual dealt Sao Paulo funk
  // sets about 1.7 times a night, on a canonicity of 86, because the measure is
  // global curation and this table is not. Nothing about them looks wrong to any
  // other guard in this file, which is why they need their own.
  //
  // The way back in is an import, not an edit: these artists release constantly
  // and the generator keeps finding them. import-songs.mjs and the generator
  // both consult the list, and this asserts they did.
  const back = corpus.filter(isExcluded)
    .map((s) => `${s.artist} - ${s.title}`);
  assert.deepEqual(back.slice(0, 8), [],
    `${back.length} excluded song(s) are back in the data -- ${back.slice(0, 8).join('; ')}`);
});

test('no seeded tag has drifted away from its own canonicity', () => {
  // batch-006 was generated, not judged: its `familiarity` is a function of its
  // canonicity, so the two are one signal wearing two hats. src/scoring.js
  // blends them believing they are independent, which is harmless only while
  // they still agree.
  //
  // They stopped agreeing. Canonicity is a percentile over the whole corpus, so
  // every import re-ranked it, and 3,400 seeded tags were left asserting a
  // popularity their own score no longer supported - 797 still `standard` and
  // 778 still `familiar` on numbers that had moved underneath them. The effect
  // reached the table: Casual dealt about one card in eight below canonicity 60,
  // which is where a song stops being one anyone can place.
  //
  // apply-canonicity.mjs now re-derives the seeded tags whenever it re-ranks.
  // This asserts it actually did, because the failure is silent by nature -
  // every value involved is a legal one.
  const seeded = new Set(
    (batches.find(([f]) => f.includes('batch-006'))?.[1] ?? [])
      .map((s) => `${s.artist}|${s.title}`.toLowerCase()),
  );

  const drifted = [];
  for (const song of corpus) {
    const id = `${song.artist}|${song.title}`.toLowerCase();
    if (!seeded.has(id) || song.canonicity === null || song.canonicity === undefined) continue;
    // A song the household has ruled on is no longer the generator's to move.
    if (verdictFor(song)?.familiarity) continue;
    const expected = familiarityFor(song.canonicity, song.genres);
    if (song.familiarity !== expected) {
      drifted.push(`${song.artist} - ${song.title}: tagged ${song.familiarity}, `
        + `canonicity ${song.canonicity} says ${expected}`);
    }
  }
  assert.deepEqual(drifted.slice(0, 10), [],
    `${drifted.length} seeded tag(s) no longer match their score -- ${drifted.slice(0, 10).join('; ')}`);
});

test('no lookup has undone a year that was established against a source', () => {
  // The same guard as above, for the field that actually breaks the game. Six
  // years were corrected on 16 August against MusicBrainz recordings and
  // Spotify, all six having been dated by the generator to a reissue single
  // rather than to the record the song came out on.
  //
  // Re-running the generator's lookup would restore all six, and no other test
  // here would notice: 1988 is a legal year, it matches the decade beside it,
  // and it is plausible. Only the fact that somebody checked makes it wrong.
  const wrong = [];
  for (const song of corpus) {
    const year = verifiedYearFor(song);
    if (year === null) continue;
    if (song.year !== year) {
      wrong.push(`${song.artist} - ${song.title}: year is ${song.year}, the check established ${year}`);
    }
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`);
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
