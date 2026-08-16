#!/usr/bin/env node
//
// Checks the nine year suspects the 16 August import raised:
//
//   node scripts/check-year-suspects-2026-08-16.mjs
//
// The import warns when Spotify dates a track EARLIER than we do. That check
// only ever fires in the direction where Spotify is likely to be right -
// Spotify's dates drift late, towards remasters and reissues, so a date of
// theirs that is earlier than ours usually means ours is the wrong one.
//
// Usually, not always, and the exception is the reason this asks MusicBrainz
// rather than just taking Spotify's number. Spotify's `earliest` is the
// earliest release carrying that title, which for a cover is the ORIGINAL
// artist's release, not ours. Dinosaur Jr.'s Just Like Heaven is a Cure song
// from 1987; the cover is 1989 and 1989 is our answer, not an error.
//
// So both MusicBrainz lookups already in this repo are run, and both filter on
// an exact artist match, which is what separates a cover from its original:
//
//   release-group  what generate-from-index.mjs uses for batch 006
//   recording      what probe-musicbrainz.mjs used to validate that choice
//
// THE RELEASE-GROUP ANSWER IS NOT EVIDENCE for a batch-006 song. Its year came
// from that same query (generate-from-index.mjs:195, character for character),
// so re-running it reproduces our own value and calls it agreement. The first
// run of this script did exactly that and reported eight of nine "confirmed".
// It is kept because it shows WHICH release-group misled the generator, which
// is the useful part, but it never votes.
//
// The recording lookup is the independent one, and it is ranked by how many
// releases carry each recording rather than by date. A song's original sits on
// dozens of releases - every compilation and reissue since - while a remaster
// sits on one. Taking the earliest date instead picks up demos and mislabelled
// bootlegs; taking the most-released recording found Cruel Summer's 2019 album
// cut under 54 releases while the 2023 single that fooled the generator had 8.
//
// Writes nothing. Every correction here is a judgement call and belongs in a
// commit somebody read first.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs } from './lib/songs-file.mjs';
import { byRecording, byReleaseGroup, PAUSE_MS, sleep } from './lib/musicbrainz.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'year-suspects-2026-08-16.json');

// --- the suspects -------------------------------------------------------------

const review = await readSongs(path.join(ROOT, 'data', 'batch-006.review.json'), {});
const suspects = review.year_suspects ?? [];
if (!suspects.length) {
  console.error('No year_suspects in data/batch-006.review.json - nothing to check.');
  process.exit(1);
}

console.log(`${suspects.length} year suspects, two MusicBrainz lookups each`);
console.log(`about ${Math.ceil((suspects.length * 2 * PAUSE_MS) / 1000)}s at their requested rate\n`);

const results = [];
for (const s of suspects) {
  const rg = await byReleaseGroup(s.artist, s.title);
  await sleep(PAUSE_MS);
  const rec = await byRecording(s.artist, s.title);
  await sleep(PAUSE_MS);

  // Only the recording lookup votes; see the header on why release-group cannot.
  // Two independent sources, Spotify and MusicBrainz recordings, and the verdict
  // is what they do relative to our year rather than to each other.
  const independent = rec.year;

  let verdict;
  if (independent === null) verdict = 'needs a human';
  else if (independent === s.our_year) verdict = 'ours confirmed';
  else if (independent <= s.spotify_earliest_year) verdict = 'ours wrong';
  else verdict = 'third answer';

  results.push({
    artist: s.artist,
    title: s.title,
    our_year: s.our_year,
    spotify: s.spotify_earliest_year,
    mb_recording: rec.year,
    mb_recording_releases: rec.releases ?? 0,
    mb_release_group: rg.year,
    release_group_is_circular: rg.year === s.our_year,
    verdict,
    why: { release_group: rg.why, recording: rec.why },
  });

  const line = `${s.artist} - ${s.title}`;
  console.log(`${line.slice(0, 44).padEnd(46)} ours ${s.our_year}  spotify ${s.spotify_earliest_year}  `
    + `rec ${String(rec.year ?? '-').padStart(4)}(${String(rec.releases ?? 0).padStart(2)} rel)  ${verdict}`);
}

await writeFile(OUT, `${JSON.stringify({ checked: suspects.length, results }, null, 2)}\n`, 'utf8');

console.log('\nsummary:');
for (const v of ['ours wrong', 'ours confirmed', 'third answer', 'needs a human']) {
  const n = results.filter((r) => r.verdict === v).length;
  if (n) console.log(`  ${v.padEnd(16)}${n}`);
}
console.log(`\nWrote ${path.relative(ROOT, OUT)}. Nothing else was changed.`);
