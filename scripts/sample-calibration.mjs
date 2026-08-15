// Draws the calibration sample of 15 August.
//
// The two reviews before this one both moved every tag the same direction -
// less known, more adults-only - and both drew from a stratum I already
// suspected was wrong. That design cannot produce a correction upward, so it
// cannot tell a real bias from the shape of the question.
//
// Three strata, shuffled together and presented without their current tags, so
// the answers can disagree with the data in either direction:
//
//   control    songs already buried as `deep` or `adults`. If none of these
//              come back as known, the downward corrections were real signal.
//              If they do, the method has been measuring my phrasing.
//   band       2005-2014, tagged `even` on the year alone with no measurement
//              of any kind. 2,390 songs rest on this.
//   genre      pre-2005 soul, reggae and funk. The thirteen "nobody here"
//              answers clustered here, which hints the urban damping is drawn
//              too narrowly - but thirteen songs across three genres is too
//              thin to act on.
//
// Seeded, so the same sample can be drawn again.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSongs } from './lib/songs-file.mjs';
import { reviewKey, REVIEWED } from './lib/reviewed.mjs';

const DIR = join(import.meta.dirname, '..', 'data');
const FILES = ['songs.json', 'batch-002.seed.json', 'batch-003.seed.json',
  'batch-004.seed.json', 'batch-005.seed.json', 'batch-006.seed.json'];
const PER_STRATUM = 10;
const SEED = 20260815;

/** mulberry32: a seeded generator, so this sample is reproducible. */
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffle = (list, next) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const corpus = new Map();
for (const file of FILES) {
  for (const song of (await readSongs(join(DIR, file))).songs) {
    if (!corpus.has(reviewKey(song))) corpus.set(reviewKey(song), song);
  }
}
// Nothing already judged: asking twice measures memory, not the song.
const pool = [...corpus.values()].filter((s) => !REVIEWED[reviewKey(s)]);

const GENRES = /soul|reggae|funk/i;
const STRATA = {
  control: (s) => s.familiarity === 'deep' || s.skew === 'adults',
  band: (s) => s.year >= 2005 && s.year < 2015,
  genre: (s) => s.year < 2005 && GENRES.test((s.genres ?? []).join(' ')),
};

const next = rng(SEED);
const taken = new Set();
const sample = [];

for (const [stratum, matches] of Object.entries(STRATA)) {
  const eligible = shuffle(pool.filter((s) => matches(s) && !taken.has(reviewKey(s))), next);
  for (const song of eligible.slice(0, PER_STRATUM)) {
    taken.add(reviewKey(song));
    sample.push({
      stratum,
      artist: song.artist,
      title: song.title,
      year: song.year,
      genres: song.genres,
      canonicity: song.canonicity,
      was: { familiarity: song.familiarity, skew: song.skew },
    });
  }
}

// Shuffled together, so neither of us can tell a stratum from its position.
const asked = shuffle(sample, next);
await writeFile(join(DIR, 'calibration-2026-08-15.json'),
  `${JSON.stringify({ seed: SEED, asked }, null, 2)}\n`, 'utf8');

console.log(`${asked.length} songs, ${PER_STRATUM} per stratum, drawn from ${pool.length} unreviewed\n`);
asked.forEach((s, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${s.artist} - ${s.title}  (${s.year})`);
});
console.log('\nstratum counts:');
for (const k of Object.keys(STRATA)) console.log(`  ${k.padEnd(9)}${asked.filter((s) => s.stratum === k).length}`);
