#!/usr/bin/env node
//
// Writes a `canonicity` score onto every song from the harvested signals:
//
//   node scripts/apply-canonicity.mjs [--dry-run]
//
// canonicity is 0-100: the song's within-decade percentile, averaged across
// Deezer playlist appearances and Last.fm listener counts.
//
// Within decade, because raw counts across decades measure the platform rather
// than the song. A 1967 track and a 2015 track face completely different
// playlist populations and scrobbling userbases, and comparing them directly
// would just rediscover that Last.fm users are young.
//
// This is computed once and stored, rather than read at runtime, because the
// playlist index is several megabytes and is never going to a phone. Only the
// single number ships.
//
// It is measured, global, and says nothing about what one South African family
// knows. `familiarity` remains the household judgement, and the sampler blends
// the two rather than letting either win outright - see src/scoring.js.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';
import { writeSongs } from './lib/songs-file.mjs';
import { percentiles, blend } from './lib/percentiles.mjs';
import { familiarityFor, cleanTitle } from './lib/seeds.mjs';
import { verdictFor } from './lib/reviewed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  'data/songs.json',
  'data/batch-002.seed.json',
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

// The one batch nobody tagged by hand. Its `familiarity` was derived from
// canonicity by the generator, which makes the two the same signal rather than
// the two independent ones scoreOf believes it is blending - so when this file
// re-ranks canonicity, that tag has to move with it or it is left asserting
// something no longer true of any source.
//
// It drifted exactly that way. Twenty-one percent of the seeded tags disagreed
// with their own canonicity by the time anyone measured, and almost all of the
// drift ran one way: 797 songs still tagged `standard` and 778 still `familiar`
// on scores that no longer supported either. The pool had grown from 1,649
// songs to 9,430 underneath them, every new arrival pushing the percentiles of
// everything above it, and Casual went on dealing them as though they were
// songs the table would know.
//
// Hand-tagged files are never touched. A person saying Yvonne Chaka Chaka's
// Umqombothi is familiar here is exactly the knowledge a global playlist count
// cannot hold, and it disagrees with canonicity on purpose.
const SEEDED = 'data/batch-006.seed.json';

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
};

const dryRun = process.argv.includes('--dry-run');

const deezer = (await readJson('data/canonicity.json', { tracks: {} })).tracks ?? {};
const lastfm = (await readJson('data/lastfm.json', { tracks: {} })).tracks ?? {};

if (Object.keys(deezer).length === 0 && Object.keys(lastfm).length === 0) {
  throw new Error('No signal data. Run harvest-playlists.mjs and fetch-lastfm.mjs first.');
}

// Gather every distinct song across every file, so percentiles are computed
// against the whole corpus rather than per file.
const docs = [];
for (const file of TARGETS) {
  const doc = await readJson(file, null);
  if (doc) docs.push({ file, doc });
}

// The index is keyed on the exact normalised title, and a song reaches it under
// whichever pressing a playlist curator happened to add. An exact lookup
// therefore misses "Another Brick In The Wall, Pt. 2 (2011 Remastered Version)"
// when we hold Part 2, and scores one of the most played records ever as though
// no playlist had ever carried it: canonicity 1, against 91 playlists sitting
// right there in the index. That is not cosmetic - a score that low is what
// familiarityFor reads to decide a song is a deep cut nobody should be dealt.
//
// It is worth being exact about the size of this. Measured across the pool it
// currently rescues one song. A first look suggested thirty, by confusing a low
// playlist count with a low percentile - a song on thirty playlists can sit at
// the 38th percentile quite legitimately if its decade is full of songs on more.
// The guard is kept because the failure is silent and permanent when it does
// happen, and because the index grows: every harvest adds pressings.
//
// So: exact first, then the same title with its version suffix removed, then a
// loose form with the abbreviations that actually vary expanded and punctuation
// dropped. The loose pass is confined to one artist's own tracks and is used
// only when it finds exactly one candidate, because two different songs
// collapsing into one score is a worse failure than the one being fixed.
const looseTitle = (t) => normalise(String(t))
  .replace(/\bpt\b/g, 'part')
  .replace(/\bvol\b/g, 'volume')
  .replace(/\bfeat\b.*$/, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Both sides go through the same pipeline, or the relaxation is one-directional:
// cleaning our title finds nothing when it is the index that carries the
// decoration, which is the usual direction.
const looseKey = (artist, title) => `${normalise(artist)}|${looseTitle(cleanTitle(title))}`;

const looseIndex = new Map();
for (const entry of Object.values(deezer)) {
  const k = looseKey(entry.artist, entry.title);
  if (!looseIndex.has(k)) looseIndex.set(k, []);
  looseIndex.get(k).push(entry);
}

let recovered = 0;
function playlistsFor(song) {
  const artist = normalise(song.artist);
  const exact = deezer[`${artist}|${normalise(song.title)}`];
  if (exact) return exact.n;

  const stripped = deezer[`${artist}|${normalise(cleanTitle(song.title))}`];
  if (stripped) { recovered++; return stripped.n; }

  const near = looseIndex.get(looseKey(song.artist, song.title)) ?? [];
  if (near.length === 1) { recovered++; return near[0].n; }
  return null;
}

const all = [];
const byIdentity = new Map();
for (const { doc } of docs) {
  for (const song of doc.songs ?? []) {
    const id = `${song.artist}|${song.title}`.toLowerCase();
    if (!byIdentity.has(id)) {
      const entry = {
        id,
        decade: song.decade,
        playlists: playlistsFor(song),
        listeners: lastfm[id]?.listeners ?? null,
      };
      byIdentity.set(id, entry);
      all.push(entry);
    }
  }
}

// Ranking lives in lib/percentiles.mjs, where it is tested. It was a private
// function here, which is how a rule as consequential as "absent is not zero"
// ended up with no test at all.

// A song absent from the playlist harvest appeared on none of the playlists we
// swept, which is a real zero: that index holds 32,898 tracks and covers 99% of
// the corpus, so absence from it is a finding rather than a gap.
//
// Last.fm is the opposite, and this line used to treat it the same way. That
// was the bug. That index is a deliberate partial pass - 1,458 tracks, taken
// when the corpus WAS 1,458 songs. The corpus is 10,927 now, so 87% of it was
// never fetched, and calling that a zero ranked seven thousand unmeasured songs
// below every measured one. It inverted the tiers outright: standard fell from
// a median of 98 to 49 while familiar rose to 93.
//
// Absent is not zero. Left null, percentiles() skips it and the average below
// uses whichever sources actually have something to say - which for most of the
// corpus means Deezer alone.
for (const s of all) {
  if (s.playlists === null) s.playlists = 0;
}

// Playlist reach is ranked across the whole corpus, not within each decade.
//
// Within-decade was the original rule, on the reasoning that a 1967 track and a
// 2015 track face different playlist populations and comparing raw counts would
// measure the platform rather than the song. Measured, that turns out to be
// mostly untrue of this index: the songs scoring 85 to 95 sit on 47 to 65
// playlists in every decade - 1960s 47, 1980s 56, 2000s 65 - so the distortion
// being guarded against is small.
//
// What the rule was doing instead was manufacturing one. The 2020s band is thin,
// so its 85-to-95 songs sit on 23 playlists, and Casual dealt Don't Go Yet and
// Moth To A Flame - nineteen playlists each out of 5,802 - as though they were
// songs everyone knows. Ranked together, reach decides, which is the question
// actually being asked: not "how does this rate among its contemporaries" but
// "has anyone here heard it".
const byPlaylists = percentiles(all, (s) => s.playlists, () => 'all');

// Listener counts stay within decade, and the asymmetry is deliberate. Last.fm's
// userbase is young, so scrobbles under-count pre-1990 music for a reason that
// is about the platform and not about the song - which is the distortion the
// original rule described, in the one source where it genuinely bites. It also
// covers 1,458 of 11,023 songs, and blend() already refuses to let a thin source
// reorder a well covered one.
const byListeners = percentiles(all, (s) => s.listeners);

const scores = new Map(all.map((s) => [s.id, blend([byPlaylists, byListeners], s.id)]));

// --- score in memory ---------------------------------------------------------
//
// Nothing is written here. The check below decides whether these scores are fit
// to keep, and it cannot do that after the files have already been overwritten.

// Which songs carry a generator-derived tag rather than a person's. Identity
// rather than file, because songs.json holds both kinds side by side once a
// seeded song has been imported into the pool.
const seededDoc = docs.find(({ file }) => file === SEEDED);
const seeded = new Set(
  (seededDoc?.doc.songs ?? []).map((s) => `${s.artist}|${s.title}`.toLowerCase()),
);

let changed = 0;
let retagged = 0;
for (const { doc } of docs) {
  doc.songs = (doc.songs ?? []).map((song) => {
    const id = `${song.artist}|${song.title}`.toLowerCase();
    const score = scores.get(id) ?? null;

    // Re-derive the seeded tag from the score it was derived from in the first
    // place. A song nobody could measure keeps whatever tag it has: there is
    // nothing to re-derive from, and guessing would be worse than stale.
    //
    // Never a song the household has ruled on. A seeded song can be reviewed
    // later - that is what a review is for - and at that moment the tag stops
    // being the generator's to move. Leaving this out flipped Montell Jordan's
    // Get It On Tonite from the `deep` the review gave it back to `familiar`,
    // which is the exact shape of the bug data.test.mjs was written for: a rule
    // and a person disagreeing, and the rule winning quietly because every
    // value it wrote was a legal one.
    const judged = verdictFor(song)?.familiarity;
    const familiarity = judged ?? (seeded.has(id) && score !== null
      ? familiarityFor(score, song.genres)
      : song.familiarity);

    if (song.canonicity === score && song.familiarity === familiarity) return song;
    if (song.canonicity !== score) changed++;
    if (song.familiarity !== familiarity) retagged++;
    return { ...song, familiarity, canonicity: score };
  });
}

// --- report ------------------------------------------------------------------

const values = [...scores.values()].filter((v) => v !== null).sort((a, b) => a - b);
console.log(`${all.length} distinct songs, ${values.length} scored`);
console.log(`${recovered} matched only after relaxing the title`);
console.log(`${changed} song records ${dryRun ? 'would be' : ''} updated across ${docs.length} files`);
console.log(`${retagged} seeded familiarity tags ${dryRun ? 'would be' : ''} re-derived from the new scores`);
console.log(`\ndistribution: min ${values[0]}, median ${values[Math.floor(values.length / 2)]}, max ${values[values.length - 1]}`);

const tiers = { standard: [], familiar: [], deep: [] };
for (const { doc } of docs) {
  for (const song of doc.songs ?? []) {
    const s = scores.get(`${song.artist}|${song.title}`.toLowerCase());
    if (s !== null && tiers[song.familiarity]) tiers[song.familiarity].push(s);
  }
}
console.log('\nsanity check - canonicity should fall across our tiers:');
const median = {};
for (const [tier, xs] of Object.entries(tiers)) {
  if (!xs.length) continue;
  const sorted = [...xs].sort((a, b) => a - b);
  median[tier] = sorted[Math.floor(sorted.length / 2)];
  console.log(`  ${tier.padEnd(10)} median ${String(median[tier]).padStart(3)}  (${xs.length} songs)`);
}

// A gate, not a note. This check printed the corruption plainly and then wrote
// it out anyway, which is how a scrambled score reached the pool: the evidence
// was on screen and nothing acted on it.
//
// The requirement is deliberately weak. The two signals are allowed to disagree
// with the tags song by song - that disagreement is the entire reason TRUST
// exists. But if the tier medians stop falling, the scores have stopped meaning
// the thing the sampler blends them as, and writing them would quietly degrade
// every draw from then on.
if (!(median.standard > median.familiar && median.familiar > median.deep)) {
  console.error('\nREFUSING TO WRITE. The medians do not fall across the tiers, so these');
  console.error('scores no longer track how well known a song is. Nothing has been changed.');
  console.error('Check that data/lastfm.json still covers enough of the corpus to rank on.');
  process.exit(1);
}

if (dryRun) {
  console.log('\nDry run: nothing written.');
} else {
  for (const { file, doc } of docs) {
    await writeSongs(path.resolve(ROOT, file), doc);
  }
  console.log(`\nWritten. ${changed} record(s) updated.`);
}


