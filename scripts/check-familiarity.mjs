#!/usr/bin/env node
//
// Cross-checks our familiarity tags against Spotify popularity and reports
// where they disagree:
//
//   node scripts/check-familiarity.mjs
//
// Spotify popularity is NOT familiarity. It measures current streaming, it
// inflates meme revivals, and it deflates songs everyone knows but nobody
// streams. It is never authoritative here.
//
// What it is good for is disagreement. A song tagged `standard` that almost
// nobody streams, or a `deep` cut with a popularity of 90, is worth a second
// look. This runs over the whole pool, which is how individual mistakes get
// caught when the human review only samples a fraction of each batch.
//
// Every flag is a question, not a verdict. Plenty will be correct as tagged.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Bands are deliberately wide. The point is to surface the clear disagreements,
// not to police every song.
const BANDS = {
  standard: { min: 40, max: 100 },
  familiar: { min: 20, max: 80 },
  deep: { min: 0, max: 65 },
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

const pool = (await readJson('data/songs.json')).songs ?? [];
const scores = (await readJson('data/popularity.json', { scores: {} })).scores ?? {};

const flags = [];
let scored = 0;
const tiers = {};
const skews = {};
const decades = {};

for (const song of pool) {
  tiers[song.familiarity ?? 'untagged'] = (tiers[song.familiarity ?? 'untagged'] ?? 0) + 1;
  skews[song.skew ?? 'untagged'] = (skews[song.skew ?? 'untagged'] ?? 0) + 1;
  decades[song.decade ?? '?'] = (decades[song.decade ?? '?'] ?? 0) + 1;

  const popularity = scores[song.spotify_uri];
  const band = BANDS[song.familiarity];
  if (typeof popularity !== 'number' || !band) continue;
  scored++;

  if (popularity < band.min) {
    flags.push({
      distance: band.min - popularity,
      line: `${song.artist} - ${song.title} (${song.year})`,
      detail: `tagged ${song.familiarity}, popularity ${popularity} - less streamed than that tier implies`,
    });
  } else if (popularity > band.max) {
    flags.push({
      distance: popularity - band.max,
      line: `${song.artist} - ${song.title} (${song.year})`,
      detail: `tagged ${song.familiarity}, popularity ${popularity} - more streamed than that tier implies`,
    });
  }
}

const table = (label, counts) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`\n${label}`);
  for (const [key, n] of rows) {
    console.log(`  ${key.padEnd(12)} ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(1)}%`);
  }
};

console.log(`pool: ${pool.length} songs, ${scored} with a popularity score`);
table('familiarity', tiers);
table('skew', skews);
table('decade', decades);

flags.sort((a, b) => b.distance - a.distance);
console.log(`\n${flags.length} disagreement(s), widest first:\n`);
for (const flag of flags) {
  console.log(`  ${flag.line}`);
  console.log(`    ${flag.detail}`);
}
if (flags.length === 0) console.log('  none');
