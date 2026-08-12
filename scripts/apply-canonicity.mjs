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

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  'data/songs.json',
  'data/batch-002.seed.json',
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
];

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

const all = [];
const byIdentity = new Map();
for (const { doc } of docs) {
  for (const song of doc.songs ?? []) {
    const id = `${song.artist}|${song.title}`.toLowerCase();
    if (!byIdentity.has(id)) {
      const entry = {
        id,
        decade: song.decade,
        playlists: deezer[`${normalise(song.artist)}|${normalise(song.title)}`]?.n ?? null,
        listeners: lastfm[id]?.listeners ?? null,
      };
      byIdentity.set(id, entry);
      all.push(entry);
    }
  }
}

/**
 * Percentile of each song within its own decade, 0-100.
 * Songs with no value for a source are excluded from that source's ranking
 * rather than treated as zero - absent data is not the same as a zero score.
 */
function percentiles(valueOf) {
  const byDecade = new Map();
  for (const s of all) {
    if (valueOf(s) === null) continue;
    if (!byDecade.has(s.decade)) byDecade.set(s.decade, []);
    byDecade.get(s.decade).push(s);
  }
  const out = new Map();
  for (const [, group] of byDecade) {
    const sorted = [...group].sort((a, b) => valueOf(a) - valueOf(b));
    sorted.forEach((s, i) => out.set(s.id, (i / Math.max(1, sorted.length - 1)) * 100));
  }
  return out;
}

// A song absent from every playlist is genuinely obscure rather than unmeasured,
// so a zero count is a real zero. A song Last.fm has never heard of is the same.
for (const s of all) {
  if (s.playlists === null) s.playlists = 0;
  if (s.listeners === null) s.listeners = 0;
}

const byPlaylists = percentiles((s) => s.playlists);
const byListeners = percentiles((s) => s.listeners);

const scores = new Map();
for (const s of all) {
  const a = byPlaylists.get(s.id);
  const b = byListeners.get(s.id);
  const both = [a, b].filter((x) => x !== undefined);
  scores.set(s.id, both.length ? Math.round(both.reduce((x, y) => x + y, 0) / both.length) : null);
}

// --- write -------------------------------------------------------------------

let changed = 0;
for (const { file, doc } of docs) {
  doc.songs = (doc.songs ?? []).map((song) => {
    const score = scores.get(`${song.artist}|${song.title}`.toLowerCase()) ?? null;
    if (song.canonicity === score) return song;
    changed++;
    return { ...song, canonicity: score };
  });

  if (!dryRun) {
    await writeFile(path.resolve(ROOT, file), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }
}

// --- report ------------------------------------------------------------------

const values = [...scores.values()].filter((v) => v !== null).sort((a, b) => a - b);
console.log(`${all.length} distinct songs, ${values.length} scored`);
console.log(`${changed} song records ${dryRun ? 'would be' : ''} updated across ${docs.length} files`);
console.log(`\ndistribution: min ${values[0]}, median ${values[Math.floor(values.length / 2)]}, max ${values[values.length - 1]}`);

const tiers = { standard: [], familiar: [], deep: [] };
for (const { doc } of docs) {
  for (const song of doc.songs ?? []) {
    const s = scores.get(`${song.artist}|${song.title}`.toLowerCase());
    if (s !== null && tiers[song.familiarity]) tiers[song.familiarity].push(s);
  }
}
console.log('\nsanity check - canonicity should fall across our tiers:');
for (const [tier, xs] of Object.entries(tiers)) {
  if (!xs.length) continue;
  const sorted = [...xs].sort((a, b) => a - b);
  console.log(`  ${tier.padEnd(10)} median ${String(sorted[Math.floor(sorted.length / 2)]).padStart(3)}  (${xs.length} songs)`);
}

if (dryRun) console.log('\nDry run: nothing written.');
