#!/usr/bin/env node
//
// Corrects six years the 16 August MusicBrainz check found wrong:
//
//   node scripts/apply-year-fixes-2026-08-16.mjs [--dry]
//
// The import raised nine suspects, being the songs where Spotify dated a track
// earlier than we did. Six were genuinely ours to fix and three were not:
// Dinosaur Jr.'s Just Like Heaven is a Cure cover and 1989 is right, while
// Sedaka's 1960 and Luther Ingram's 1967 are Spotify compilation noise.
//
// Every one of the six is the same error. Our year is the date of a single or a
// re-release rather than of the record the song first appeared on, because the
// generator dates from MusicBrainz release-groups and an exact-title match
// prefers a standalone single over the album that carried it. See
// scripts/lib/musicbrainz.mjs for the mechanism and the evidence.
//
// The evidence for each correction is a recording carried by many releases -
// the original accumulates every compilation since, a reissue does not - and in
// all six cases Spotify independently agrees with it. Both numbers are recorded
// below so a later reader can weigh the change without re-running anything.
//
// `decade` is derived from `year` and moves with it. Nothing else does, and the
// script proves that rather than assuming it: see the seed check at the end.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs, writeSongs } from './lib/songs-file.mjs';
import { decadeOf, skewFor } from './lib/seeds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry');

// Both files, because the pool is what the app deals tonight and the batch is
// what a later re-seed reads. Correcting one and not the other is how four
// reviewed songs went stale in the pool on 15 August.
const TARGETS = ['data/songs.json', 'data/batch-006.seed.json'];

/** artist|title lower case -> the correction and why it is believed. */
const FIXES = {
  'taylor swift|cruel summer': {
    from: 2023, to: 2019,
    why: 'Lover, 2019-08-23. The 2019 recording carries 54 releases against the '
       + '2023 single\'s 8; 2023 is when it was released as a single and charted.',
    spotify: 2019,
  },
  'bush|machinehead': {
    from: 1996, to: 1994,
    why: 'Sixteen Stone, 1994-12-06. The recording carries 79 releases. '
       + 'MusicBrainz has no release-group for it but the 1996 single.',
    spotify: 1994,
  },
  'frankie knuckles|your love': {
    from: 2003, to: 1987,
    why: 'The Trax 12" Baby Wants to Ride / Your Love, 1987. The recording '
       + 'carries 56 releases; the 2003 release-group the generator took is a '
       + 'single reissue with one.',
    spotify: 1987,
  },
  'måneskin|beggin\'': {
    from: 2023, to: 2017,
    why: 'Chosen, 2017-12-08, carrying 22 releases. MusicBrainz has no matching '
       + 'release-group at all - the apostrophe differs - so this one fell '
       + 'through to Deezer, which dated the 2021 viral re-release.',
    spotify: 2017,
  },
  'ramones|i wanna be sedated': {
    from: 1988, to: 1978,
    why: 'Road to Ruin, 1978. The original single is filed as "She\'s the One / '
       + 'I Wanna Be Sedated", so the exact-title filter discarded it and took a '
       + '1988 reissue single instead. MusicBrainz\'s Ramones recordings are '
       + 'compilation soup and rank badly; the release-group shows it plainly.',
    spotify: 1978,
  },
  'mayhem|freezing moon': {
    from: 1996, to: 1994,
    why: 'De Mysteriis Dom Sathanas, 1994. The 1996 release-group is a '
       + 'standalone single. The most-carried recording dates to a 1995 '
       + 'pressing of the same album.',
    spotify: 1994,
  },
};

const key = (song) => `${song.artist}|${song.title}`.toLowerCase();

const counts = { fixed: 0, files: 0 };
const movedDecade = new Set();
const seen = new Set();
const seedDrift = [];

for (const file of TARGETS) {
  const full = path.resolve(ROOT, file);
  const doc = await readSongs(full, null);
  if (!doc) { console.log(`${file}: absent, skipped`); continue; }

  let touched = 0;
  doc.songs = (doc.songs ?? []).map((song) => {
    const fix = FIXES[key(song)];
    if (!fix) return song;

    // A song already at the corrected year is not an error to re-report, but a
    // song at neither the old nor the new year is a surprise and must not be
    // quietly overwritten - the data moved under this script.
    if (song.year === fix.to) return song;
    if (song.year !== fix.from) {
      throw new Error(`${key(song)} in ${file} is ${song.year}, expected ${fix.from} `
        + `or ${fix.to}. Refusing to overwrite a year this script did not predict.`);
    }

    const decade = decadeOf(fix.to);
    if (decade !== song.decade) movedDecade.add(key(song));
    seen.add(key(song));
    touched++;

    // Neither seed reads `year` in a way these corrections move: familiarity
    // does not read it at all, and skew only asks whether the song is 2015 or
    // later, which none of the six crosses. Asserted rather than trusted,
    // because a seed silently disagreeing with the data is exactly the failure
    // lib/reviewed.mjs was written after.
    //
    // The question is strictly whether THIS CHANGE moves a seed, so both sides
    // are evaluated at the same canonicity and differ only in the year. Asking
    // instead whether the stored tag matches the rule is a different question
    // with a different answer: three of the six already disagree, because the
    // pool holds hand-tagged and re-seeded songs that no longer reproduce from
    // the current thresholds. That is pre-existing and not this script's to
    // touch - repairing it here would be the 15 August re-seed all over again.
    const before = skewFor(fix.from, song.canonicity);
    const after = skewFor(fix.to, song.canonicity);
    if (before !== after) {
      seedDrift.push({ song: key(song), file, before, after });
    }

    return { ...song, year: fix.to, decade };
  });

  if (touched && !dryRun) await writeSongs(full, doc);
  if (touched) counts.files++;
  console.log(`${file.padEnd(28)} ${touched} corrected`);
}

counts.fixed = seen.size;

// --- report -------------------------------------------------------------------

console.log('');
for (const [k, fix] of Object.entries(FIXES)) {
  const [artist, title] = k.split('|');
  const moved = decadeOf(fix.from) !== decadeOf(fix.to) ? `  ${decadeOf(fix.from)} -> ${decadeOf(fix.to)}` : '';
  console.log(`  ${fix.from} -> ${fix.to}  ${`${artist} - ${title}`.slice(0, 44).padEnd(46)}`
    + `spotify ${fix.spotify}${moved}`);
}

console.log(`\n${counts.fixed}/${Object.keys(FIXES).length} songs corrected across ${counts.files} file(s), `
  + `${movedDecade.size} of them into a different decade`);

const missing = Object.keys(FIXES).filter((k) => !seen.has(k));
if (missing.length) {
  console.log(`\n${missing.length} already at the corrected year, or absent:`);
  for (const m of missing) console.log(`  ${m}`);
}

if (seedDrift.length) {
  console.warn('\nWARNING: a year change moved a skew seed. That was not expected here');
  console.warn('and the tag in the data is now the old year\'s answer. Check before committing:');
  for (const d of seedDrift) console.warn(`  ${d.song} in ${d.file}: ${d.before} -> ${d.after}`);
} else {
  console.log('\nNo seed moved: familiarity does not read year, and no correction');
  console.log('crosses the 2015 boundary that is the only year skew asks about.');
}

// canonicity is a within-decade percentile, so a song that changed decade now
// carries a rank computed against the decade it has left. It is not corrected
// here: that is apply-canonicity.mjs's job, it needs the whole corpus to rank
// against, and it currently disagrees with 455 records for an unrelated reason
// - the pool grew by 665 songs this morning and nothing re-ran it since.
// Folding that in would bury six deliberate corrections under 455 mechanical
// ones.
if (movedDecade.size) {
  console.log(`\n${movedDecade.size} song(s) changed decade. Their canonicity is still ranked`);
  console.log('against the decade they left. Run apply-canonicity.mjs to re-rank the corpus,');
  console.log('which is due on its own account, and review that as its own change.');
}

if (dryRun) console.log('\nDry run: nothing written.');
