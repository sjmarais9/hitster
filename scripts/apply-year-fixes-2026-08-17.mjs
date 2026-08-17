#!/usr/bin/env node
//
// Applies the five years the 17 August import confirmed:
//
//   node scripts/apply-year-fixes-2026-08-17.mjs [--dry]
//
// First run with the two-source check live. 662 songs imported, 15 disputed
// years, and for the first time they arrive sorted: 5 where Spotify and
// MusicBrainz independently landed on the same earlier year, 3 where one source
// spoke and the other could not, 7 where the second source backed us.
//
// Only the 5 are applied. Each is corroborated a third time by the album name
// already in the pool, which is checked below rather than asserted - Talking
// Back To The Night, One-X, A Christmas Gift For You, Songs About Jane.
//
// Every one is the same error the six of 16 August were: our year is the single
// or the reissue, not the record. Darlene Love is the extreme case at sixty
// years, a 1963 Phil Spector recording dated 2023 from a Christmas compilation.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs, writeSongs } from './lib/songs-file.mjs';
import { decadeOf, skewFor } from './lib/seeds.mjs';
import { verdictFor } from './lib/reviewed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry');

const TARGETS = ['data/songs.json', 'data/batch-006.seed.json'];

/**
 * The confirmed five. `album` is the fragment expected in the pool's album
 * field, so a correction cannot be applied to a song whose record does not
 * match the reasoning that justified it.
 */
const FIXES = {
  'steve winwood|valerie': {
    from: 1987, to: 1982, spotify: 1982, musicbrainz: 1982,
    album: 'Talking Back To The Night',
    why: 'Talking Back To The Night, 1982. Ours is the 1987 remix single.',
  },
  'three days grace|never too late': {
    from: 2008, to: 2006, spotify: 2006, musicbrainz: 2006,
    album: 'One-X',
    why: 'One-X, 2006. Ours is the single release.',
  },
  'three days grace|pain': {
    from: 2008, to: 2006, spotify: 2006, musicbrainz: 2006,
    album: 'One-X',
    why: 'One-X, 2006. Ours is the single release.',
  },
  'darlene love|christmas (baby please come home)': {
    from: 2023, to: 1963, spotify: 1963, musicbrainz: 1963,
    album: 'A Christmas Gift For You',
    why: 'A Christmas Gift For You From Phil Spector, 1963. Ours is a modern '
       + 'Christmas compilation - the largest single error found in the pool.',
  },
  'maroon 5|sunday morning': {
    from: 2004, to: 2002, spotify: 2002, musicbrainz: 2002,
    album: 'Songs About Jane',
    why: 'Songs About Jane, 2002. Ours is the 2004 single; the pool holds the '
       + '10th Anniversary pressing, whose Spotify date is still the original.',
  },
};

const key = (song) => `${song.artist}|${song.title}`.toLowerCase();

const seen = new Set();
const movedDecade = new Set();
const seedDrift = [];
let files = 0;

for (const file of TARGETS) {
  const full = path.resolve(ROOT, file);
  const doc = await readSongs(full, null);
  if (!doc) { console.log(`${file}: absent, skipped`); continue; }

  let touched = 0;
  doc.songs = (doc.songs ?? []).map((song) => {
    const fix = FIXES[key(song)];
    if (!fix) return song;
    if (song.year === fix.to) return song;
    if (song.year !== fix.from) {
      throw new Error(`${key(song)} in ${file} is ${song.year}, expected ${fix.from} `
        + `or ${fix.to}. Refusing to overwrite a year this script did not predict.`);
    }

    // The album is the third source and the only one a later reader can check
    // without a network. If the pool does not hold the record the reasoning
    // names, the reasoning is about a different song. The batch files carry no
    // album - it arrives from Spotify at import - so this only binds the pool.
    if (song.album && !song.album.toLowerCase().includes(fix.album.toLowerCase())) {
      throw new Error(`${key(song)} is on "${song.album}", but this correction argues `
        + `from "${fix.album}". Refusing to apply reasoning that does not fit the record.`);
    }

    const decade = decadeOf(fix.to);
    if (decade !== song.decade) movedDecade.add(key(song));

    seen.add(key(song));
    touched++;
    const corrected = { ...song, year: fix.to, decade };

    // skew asks one thing of the year: whether the song came out after the
    // children could choose their own music. Darlene Love crosses it, 2023 to
    // 1963, and leaving the tag alone would keep a Phil Spector record filed as
    // music the children own - which is the crowd slider reading a wrong year
    // as a fact about the household, the exact fault the 2005-2014 band had.
    //
    // Only where a rule seeded it. A judgement from the household outranks this
    // and is left standing; data.test.mjs enforces that either way.
    const before = skewFor(fix.from, song.canonicity);
    const after = skewFor(fix.to, song.canonicity);
    if (before !== after) {
      const judged = verdictFor(song);
      if (judged?.skew) {
        seedDrift.push({ song: key(song), file, before, after, held: judged.skew });
      } else {
        seedDrift.push({ song: key(song), file, before, after, reseeded: true });
        corrected.skew = after;
      }
    }

    return corrected;
  });

  if (touched && !dryRun) await writeSongs(full, doc);
  if (touched) files++;
  console.log(`${file.padEnd(28)} ${touched} corrected`);
}

console.log('');
for (const [k, fix] of Object.entries(FIXES)) {
  const [artist, title] = k.split('|');
  const moved = decadeOf(fix.from) !== decadeOf(fix.to) ? `  ${decadeOf(fix.from)} -> ${decadeOf(fix.to)}` : '';
  console.log(`  ${fix.from} -> ${fix.to}  ${`${artist} - ${title}`.slice(0, 40).padEnd(42)}`
    + `sp ${fix.spotify}  mb ${fix.musicbrainz}${moved}`);
}

console.log(`\n${seen.size}/${Object.keys(FIXES).length} songs corrected across ${files} file(s), `
  + `${movedDecade.size} into a different decade`);

const missing = Object.keys(FIXES).filter((k) => !seen.has(k));
if (missing.length) {
  console.log(`\n${missing.length} already corrected, or absent:`);
  for (const m of missing) console.log(`  ${m}`);
}

if (seedDrift.length) {
  console.log('\nskew re-seeded where the new year crosses the 2015 line:');
  for (const d of seedDrift) {
    console.log(d.reseeded
      ? `  ${d.song}: ${d.before} -> ${d.after}  (${path.basename(d.file)})`
      : `  ${d.song}: rule says ${d.after}, HELD at ${d.held} - the household judged it`);
  }
} else {
  console.log('\nNo seed moved: familiarity does not read year, and no correction');
  console.log('crosses the 2015 boundary that is the only year skew asks about.');
}

if (movedDecade.size) {
  console.log(`\n${movedDecade.size} song(s) changed decade; their canonicity is still ranked`);
  console.log('against the decade they left. apply-canonicity.mjs re-ranks the corpus.');
}

if (dryRun) console.log('\nDry run: nothing written.');
