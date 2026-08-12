#!/usr/bin/env node
//
// Joins the playlist canonicity index to our songs and asks whether it agrees
// with the familiarity tags we assigned by hand:
//
//   node scripts/score-canonicity.mjs
//
// This is the validation step, and it comes before any use of the data. If
// `standard` songs do not score higher than `deep` ones, playlist frequency is
// not measuring what we want and should be dropped - exactly as Spotify
// popularity was, though that failed for a duller reason.
//
// Nothing here writes to the pool. It reports.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
};

const canon = await readJson('data/canonicity.json', { tracks: {}, meta: {} });
const index = canon.tracks ?? {};

const sources = ['data/songs.json', 'data/batch-003.seed.json', 'data/batch-004.seed.json', 'data/batch-005.seed.json'];
const songs = [];
for (const file of sources) {
  const doc = await readJson(file, { songs: [] });
  songs.push(...(doc.songs ?? []));
}

// Deduplicate: the pool already contains batch 002.
const seen = new Set();
const pool = songs.filter((s) => {
  const k = `${s.artist}|${s.title}`.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const keyFor = (s) => `${normalise(s.artist)}|${normalise(s.title)}`;

const matched = [];
const missing = [];
for (const song of pool) {
  const hit = index[keyFor(song)];
  if (hit) matched.push({ ...song, n: hit.n, decades: hit.decades, genres: hit.genres });
  else missing.push(song);
}

console.log(`index: ${Object.keys(index).length} tracks from ${canon.meta?.playlists ?? '?'} playlists`);
console.log(`our songs: ${pool.length}`);
console.log(`matched: ${matched.length} (${((matched.length / pool.length) * 100).toFixed(1)}%)`);
console.log(`unmatched: ${missing.length} - absence is itself a signal of obscurity\n`);

if (matched.length === 0) {
  console.log('Nothing matched yet. Let the harvester finish and re-run.');
  process.exit(0);
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// --- the validation ----------------------------------------------------------

console.log('DOES IT AGREE WITH OUR TAGS?');
console.log('tier         n songs   matched   median n   mean n   max n');
for (const tier of ['standard', 'familiar', 'deep']) {
  const all = pool.filter((s) => s.familiarity === tier);
  const hits = matched.filter((s) => s.familiarity === tier);
  const ns = hits.map((s) => s.n);
  const mean = ns.length ? (ns.reduce((a, b) => a + b, 0) / ns.length) : 0;
  console.log(
    `  ${tier.padEnd(10)} ${String(all.length).padStart(6)}  ` +
    `${`${((hits.length / (all.length || 1)) * 100).toFixed(0)}%`.padStart(8)}  ` +
    `${String(median(ns)).padStart(8)}   ${mean.toFixed(1).padStart(6)}  ${String(Math.max(0, ...ns)).padStart(5)}`,
  );
}
console.log('\nIf median n does not fall from standard to deep, the signal is not usable.');

// --- disagreements -----------------------------------------------------------

const ranked = [...matched].sort((a, b) => b.n - a.n);
const cutoffHigh = ranked[Math.floor(ranked.length * 0.1)]?.n ?? 0;
const cutoffLow = ranked[Math.floor(ranked.length * 0.75)]?.n ?? 0;

const tooLow = matched.filter((s) => s.familiarity === 'deep' && s.n >= cutoffHigh);
const tooHigh = matched.filter((s) => s.familiarity === 'standard' && s.n <= cutoffLow);

console.log(`\nTagged deep but in the top 10% of playlist appearances (n >= ${cutoffHigh}): ${tooLow.length}`);
for (const s of tooLow.sort((a, b) => b.n - a.n).slice(0, 20)) {
  console.log(`  n=${String(s.n).padStart(3)}  ${s.artist} - ${s.title} (${s.year})`);
}

console.log(`\nTagged standard but in the bottom quartile (n <= ${cutoffLow}): ${tooHigh.length}`);
for (const s of tooHigh.sort((a, b) => a.n - b.n).slice(0, 20)) {
  console.log(`  n=${String(s.n).padStart(3)}  ${s.artist} - ${s.title} (${s.year})`);
}

// --- what a derived score would look like ------------------------------------

console.log('\nProposed 1-10 canonicity score, by percentile of n among matched songs:');
const buckets = Array.from({ length: 10 }, (_, i) => {
  const lo = Math.floor((i / 10) * ranked.length);
  const hi = Math.floor(((i + 1) / 10) * ranked.length);
  const slice = ranked.slice(lo, hi);
  return { score: 10 - i, min: Math.min(...slice.map((s) => s.n)), max: Math.max(...slice.map((s) => s.n)), count: slice.length };
});
for (const b of buckets) {
  console.log(`  score ${String(b.score).padStart(2)}  n ${String(b.min).padStart(3)}-${String(b.max).padStart(3)}  ${b.count} songs`);
}
console.log(`  score  0  unmatched            ${missing.length} songs`);
