#!/usr/bin/env node
//
// Measures how often batch 006's generated years are the single or re-release
// date rather than the original:
//
//   node scripts/sample-batch006-years-2026-08-16.mjs [--n 200]
//
// The 16 August import raised nine year suspects and six were wrong, every one
// of them in the same direction and by the same mechanism: MusicBrainz's
// release-group lookup prefers a standalone single, because the album that
// first carried the song is titled something else and the exact-title filter
// discards it. See scripts/lib/musicbrainz.mjs.
//
// Those nine were not a sample. They are the songs where Spotify's date
// happened to disagree with ours, which is a narrow and biased window - it only
// ever opens when Spotify has the earlier date. The real rate across the 9,440
// songs in batch 006 is unmeasured, and 665 of them are already in the pool
// with 8,775 due to import over the next fortnight. If the rate is meaningful,
// the generator's year source wants replacing before that happens.
//
// So: a seeded random sample, checked against the recording lookup, which is
// independent of the one that produced these years.
//
// A disagreement is not proof we are wrong - MusicBrainz is not an oracle and
// its coverage is patchy. The DIRECTION is the evidence. Errors of dating drift
// both ways at random; a single-vs-album bias drifts one way only. If ours are
// systematically later, that is the mechanism showing up at scale.
//
// Writes nothing but its own report.

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs } from './lib/songs-file.mjs';
import { byRecording, PAUSE_MS, sleep } from './lib/musicbrainz.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const N = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 200;
const SEED = 20260816;

// The 200-song run is committed evidence for a finding, so a longer run writes
// somewhere else rather than growing that file underneath it. Seed the new file
// by copying the old one and the overlap is not asked of MusicBrainz twice -
// the sample is a prefix of the sweep, same seed, same shuffle.
const OUT = args.includes('--out')
  ? path.resolve(ROOT, args[args.indexOf('--out') + 1])
  : path.join(ROOT, 'data', 'batch006-year-sample-2026-08-16.json');

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

const { songs } = await readSongs(path.join(ROOT, 'data', 'batch-006.seed.json'));
// Plain random, not stratified by decade: the question is the rate across the
// batch as it actually is, and weighting the thin decades up would answer a
// different one. The decade breakdown below is read out of the sample after.
const sample = shuffle(songs, rng(SEED)).slice(0, N);

// Resume support - the run is long enough that losing it to a dropped
// connection would be annoying, and MusicBrainz should not be asked twice.
const done = await (async () => {
  try { return JSON.parse(await readFile(OUT, 'utf8')).results ?? []; } catch { return []; }
})();
const seen = new Set(done.map((r) => `${r.artist}|${r.title}`));
const todo = sample.filter((s) => !seen.has(`${s.artist}|${s.title}`));

console.log(`${songs.length} songs in batch 006, sampling ${sample.length} at seed ${SEED}`);
if (done.length) console.log(`${done.length} already checked, ${todo.length} to go`);
console.log(`about ${Math.ceil((todo.length * PAUSE_MS) / 60000)} minutes at MusicBrainz's requested rate\n`);

const results = [...done];
let n = 0;
for (const song of todo) {
  const mb = await byRecording(song.artist, song.title);
  await sleep(PAUSE_MS);

  results.push({
    artist: song.artist,
    title: song.title,
    our_year: song.year,
    mb_year: mb.year,
    mb_releases: mb.releases,
    gap: mb.year === null ? null : song.year - mb.year,
    decade: song.decade,
  });

  if (++n % 25 === 0) {
    await writeFile(OUT, `${JSON.stringify({ seed: SEED, n: N, results }, null, 2)}\n`, 'utf8');
    console.log(`  ... ${n}/${todo.length} checked`);
  }
}

await writeFile(OUT, `${JSON.stringify({ seed: SEED, n: N, results }, null, 2)}\n`, 'utf8');

// --- what it found -----------------------------------------------------------

const dated = results.filter((r) => r.mb_year !== null);
const exact = dated.filter((r) => r.gap === 0);
// One year either way is a pressing date, not a different song, and the game
// cannot tell the difference. Two or more is a real disagreement.
const near = dated.filter((r) => r.gap !== 0 && Math.abs(r.gap) <= 1);
const ourLater = dated.filter((r) => r.gap >= 2);
const ourEarlier = dated.filter((r) => r.gap <= -2);

console.log(`\n${results.length} sampled, ${dated.length} dated by MusicBrainz `
  + `(${Math.round((100 * dated.length) / results.length)}% coverage)\n`);
console.log(`  exact                ${String(exact.length).padStart(4)}  ${pct(exact.length)}`);
console.log(`  within a year        ${String(near.length).padStart(4)}  ${pct(near.length)}`);
console.log(`  ours LATER by 2+     ${String(ourLater.length).padStart(4)}  ${pct(ourLater.length)}   <- the single/reissue bias`);
console.log(`  ours EARLIER by 2+   ${String(ourEarlier.length).padStart(4)}  ${pct(ourEarlier.length)}`);

function pct(n) { return `${((100 * n) / dated.length).toFixed(1)}%`.padStart(6); }

// The asymmetry is the finding. Random dating error is symmetric; a mechanism
// is not. If later outnumbers earlier several times over, that is the bug.
const ratio = ourEarlier.length ? (ourLater.length / ourEarlier.length).toFixed(1) : '∞';
console.log(`\n  later:earlier ratio  ${ratio}  (1.0 would mean random error, not a mechanism)`);

const bad = [...ourLater].sort((a, b) => b.gap - a.gap).slice(0, 15);
if (bad.length) {
  console.log('\nworst offenders:');
  for (const r of bad) {
    console.log(`  +${String(r.gap).padStart(2)}  ${`${r.artist} - ${r.title}`.slice(0, 50).padEnd(52)}`
      + `ours ${r.our_year}  mb ${r.mb_year} (${r.mb_releases} rel)`);
  }
}

console.log('\nby decade (ours later by 2+):');
const decades = [...new Set(dated.map((r) => r.decade))].sort();
for (const d of decades) {
  const inDecade = dated.filter((r) => r.decade === d);
  const late = inDecade.filter((r) => r.gap >= 2).length;
  console.log(`  ${d}  ${String(late).padStart(3)}/${String(inDecade.length).padEnd(4)} `
    + `${`${((100 * late) / inDecade.length).toFixed(0)}%`.padStart(4)}`);
}

console.log(`\nWrote ${path.relative(ROOT, OUT)}. Nothing else was changed.`);
