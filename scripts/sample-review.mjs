#!/usr/bin/env node
//
// Pulls a review sample from a batch: node scripts/sample-review.mjs [file] [n]
//
// Batch 006's tags were seeded from measured canonicity and year, not written by
// anyone. The seeds are reasonable rules, but a rule is not a judgement about
// one family in South Africa, and 9,469 songs is far too many to read.
//
// So: two samples of ten, for two different questions.
//
//   BORDERLINE  the songs the seed nearly tagged the other way. Every threshold
//               flips on a hair - 85 for standard, 45 for deep, 65 for shared -
//               and a song one point either side got its tag from arithmetic
//               rather than from anything real. If the rules are sound these are
//               where they are weakest, so errors should cluster here.
//
//   RANDOM      an unbiased draw. The borderline sample says how bad the worst
//               case is; only this one says what the batch as a whole is like.
//               Correcting the first and extrapolating from it would overstate
//               the error rate badly.
//
// Deterministic: the same file gives the same sample every time, so a review can
// be stopped and resumed without reshuffling.

import { readSongs } from './lib/songs-file.mjs';
import { STANDARD, FAMILIAR, SHARED } from './lib/seeds.mjs';

const file = process.argv[2] ?? 'data/batch-006.seed.json';
const each = Number(process.argv[3]) || 10;

const { songs } = await readSongs(file);

/** A stable pseudo-random ordering, so the sample does not move between runs. */
function shuffled(list) {
  let seed = 20260815;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return list
    .map((song) => ({ song, at: random() }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.song);
}

/** How close a song sits to the nearest boundary that decided one of its tags. */
function borderline(song) {
  const c = song.canonicity;
  if (c === null || c === undefined) return Infinity;

  const distances = [Math.abs(c - STANDARD), Math.abs(c - FAMILIAR)];
  // The skew threshold only applies to songs old enough for it to be consulted.
  if (song.year < 2005) distances.push(Math.abs(c - SHARED));
  return Math.min(...distances);
}

const ranked = [...songs].sort((a, b) => borderline(a) - borderline(b));
const edge = ranked.slice(0, each);
const chosen = new Set(edge.map((s) => `${s.artist}|${s.title}`));
const random = shuffled(songs.filter((s) => !chosen.has(`${s.artist}|${s.title}`))).slice(0, each);

const show = (title, list, note) => {
  console.log(`\n${title}`);
  console.log(note);
  console.log('');
  for (const [i, s] of list.entries()) {
    const name = `${s.artist} - ${s.title}`;
    console.log(`${String(i + 1).padStart(3)}. ${name.slice(0, 52).padEnd(54)}`
      + `${s.year}  ${String(s.familiarity).padEnd(9)}${String(s.skew).padEnd(7)}`
      + `canon ${String(s.canonicity).padStart(3)}  ${(s.genres ?? []).join('/')}`);
  }
};

console.log(`${songs.length} songs in ${file}, none of them reviewed.`);
console.log('\nfamiliarity: standard = everyone knows it, familiar = you would place it, deep = a cut');
console.log('skew:        adults / even / kids - who at the table knows it, not which era it is from');

show('BORDERLINE - the seed nearly went the other way',
  edge,
  'Errors should cluster here if the thresholds are set wrong.');

show('RANDOM - an unbiased read on the batch',
  random,
  'This is the sample the error rate should be estimated from.');

console.log('\nFor each: is the familiarity right, and is the skew right?');
console.log('Only the ones that are wrong need saying - anything unmentioned is taken as correct.');
