#!/usr/bin/env node
//
// Two questions, before building anything on top of the playlist index:
//
//   node scripts/probe-musicbrainz.mjs
//
// 1. Can MusicBrainz be trusted for `year`? Tested against songs we already
//    have years for, several of them owner-verified. If it disagrees with our
//    known-good years it cannot be used for unknown ones.
//
// 2. How much junk is in the playlist index? Playlists are full of remixes,
//    live versions, karaoke and tribute-band covers, none of which belong in
//    the pool.
//
// MusicBrainz asks for one request per second and a real User-Agent. Both are
// honoured; this is somebody's free service.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'HitsterPool/1.0 (sjmarais@inrangegolf.com)';
const PAUSE_MS = 1100;
const SAMPLE = 50;

const readJson = async (f) => JSON.parse(await readFile(path.resolve(ROOT, f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firstReleaseYear(artist, title) {
  const q = `artist:"${artist.replace(/"/g, '')}" AND recording:"${title.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=8`;

  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) return { year: null, why: `${response.status}` };

  const body = await response.json();
  const recordings = body.recordings ?? [];
  if (!recordings.length) return { year: null, why: 'no match' };

  // Only consider recordings whose artist and title actually match; MusicBrainz
  // returns fuzzy hits with high scores that are entirely different songs.
  const wantArtist = normalise(artist);
  const wantTitle = normalise(title);
  const viable = recordings.filter((r) => {
    const gotTitle = normalise(r.title ?? '');
    const gotArtists = (r['artist-credit'] ?? []).map((a) => normalise(a.name ?? ''));
    return gotTitle === wantTitle && gotArtists.some((a) => a === wantArtist);
  });

  if (!viable.length) return { year: null, why: 'no exact artist+title match' };

  // The earliest date across matching recordings is the original release; later
  // ones are reissues and remasters of the same performance.
  const years = viable
    .map((r) => r['first-release-date'])
    .filter(Boolean)
    .map((d) => Number(String(d).slice(0, 4)))
    .filter((y) => y > 1900 && y < 2030);

  if (!years.length) return { year: null, why: 'matched but undated' };
  return { year: Math.min(...years), why: 'ok' };
}

// --- 1. is MusicBrainz accurate on years we already know? --------------------

const pool = (await readJson('data/songs.json')).songs;

// Spread across decades rather than taking the first N, which would be all 1950s.
const byDecade = new Map();
for (const s of pool) {
  if (!byDecade.has(s.decade)) byDecade.set(s.decade, []);
  byDecade.get(s.decade).push(s);
}
const sample = [];
let round = 0;
while (sample.length < SAMPLE) {
  let added = false;
  for (const [, group] of byDecade) {
    if (group[round]) { sample.push(group[round]); added = true; }
    if (sample.length >= SAMPLE) break;
  }
  if (!added) break;
  round++;
}

console.log(`Checking ${sample.length} songs with known years against MusicBrainz`);
console.log('(about a minute, one request per second as they ask)\n');

let exact = 0;
let within1 = 0;
let missing = 0;
const wrong = [];

for (const song of sample) {
  const { year, why } = await firstReleaseYear(song.artist, song.title);
  if (year === null) {
    missing++;
  } else if (year === song.year) {
    exact++;
  } else if (Math.abs(year - song.year) <= 1) {
    within1++;
  } else {
    wrong.push({ ...song, mb: year, gap: year - song.year });
  }
  await sleep(PAUSE_MS);
}

const matched = sample.length - missing;
console.log(`matched: ${matched}/${sample.length}   unmatched: ${missing}`);
console.log(`  exact year:      ${exact}  (${((exact / matched) * 100).toFixed(0)}% of matched)`);
console.log(`  within one year: ${within1}`);
console.log(`  disagree by 2+:  ${wrong.length}`);

if (wrong.length) {
  console.log('\ndisagreements, ours vs MusicBrainz:');
  for (const w of wrong.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))) {
    console.log(`  ${w.artist} - ${w.title}: ours ${w.year}, MB ${w.mb} (${w.gap > 0 ? '+' : ''}${w.gap})`);
  }
}

// --- 2. how much of the playlist index is junk? ------------------------------

const index = (await readJson('data/canonicity.json')).tracks;
const entries = Object.entries(index);

const JUNK = [
  [/\bkaraoke\b/i, 'karaoke'],
  [/\bmade popular by\b|\btribute\b|\bin the style of\b/i, 'tribute'],
  [/\blive\b(?!\s*(and|to|at last))/i, 'live'],
  [/\bremix\b|\bedit\b|\bmix\)/i, 'remix'],
  [/\bcover\b/i, 'cover'],
  [/\binstrumental\b|\bbacking track\b/i, 'instrumental'],
  [/\bremaster(ed)?\b/i, 'remaster'],
];

const counts = {};
let clean = 0;
for (const [, entry] of entries) {
  const label = JUNK.find(([re]) => re.test(entry.title))?.[1];
  if (label) counts[label] = (counts[label] ?? 0) + 1;
  else clean++;
}

console.log(`\n\nPlaylist index: ${entries.length} distinct tracks`);
console.log(`  usable as-is: ${clean} (${((clean / entries.length) * 100).toFixed(0)}%)`);
for (const [label, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(13)} ${String(n).padStart(6)}`);
}

const strong = entries.filter(([, e]) => e.n >= 5 && !JUNK.some(([re]) => re.test(e.title)));
console.log(`\n  clean and on 5+ playlists: ${strong.length} candidate songs`);
