#!/usr/bin/env node
//
// One command for a scheduled daily run:
//
//   node scripts/import-daily.mjs
//
// Works through every batch in order, resolving songs to Spotify URIs until the
// daily quota runs out, then stops cleanly. Run it again tomorrow and it picks
// up exactly where it left off, because the import checkpoints every 25 songs
// and skips anything already resolved.
//
// Needs no browser after the first run: the refresh token is cached by
// lib/cli-auth.mjs. Seed it once with an interactive import, then this can be a
// scheduled task and forgotten about.
//
// Exit codes:
//   0   everything that could be imported was
//   75  quota reached, stopped for today, progress saved (not an error)
//   1   something actually went wrong

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs } from './lib/songs-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXIT_RATE_LIMITED = 75;

// Oldest first, so the batches that have been waiting longest become playable
// first. batch-002 is already in the pool.
const BATCHES = [
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '3001';

function runImport(file) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', 'import-songs.mjs'), '--in', file, '--port', PORT],
      { cwd: ROOT, stdio: 'inherit' },
    );
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** How many songs in a batch still have no URI. */
async function outstanding(file) {
  const doc = await readSongs(path.resolve(ROOT, file), null);
  if (!doc) return null;

  const pool = await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] });
  const resolved = new Set(
    (pool.songs ?? [])
      .filter((s) => s.spotify_uri)
      .map((s) => `${s.artist}|${s.title}|${s.year}`.toLowerCase()),
  );

  return (doc.songs ?? []).filter(
    (s) => !resolved.has(`${s.artist}|${s.title}|${s.year}`.toLowerCase()),
  ).length;
}

const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
console.log(`=== daily import, ${started} ===\n`);

let hitQuota = false;

for (const file of BATCHES) {
  const todo = await outstanding(file);

  if (todo === null) {
    console.log(`${file}: not present, skipping`);
    continue;
  }
  if (todo === 0) {
    console.log(`${file}: fully imported`);
    continue;
  }

  console.log(`\n${file}: ${todo} songs outstanding`);
  const code = await runImport(file);

  if (code === EXIT_RATE_LIMITED) {
    hitQuota = true;
    console.log(`\nQuota reached. Stopping for today; everything resolved has been saved.`);
    break;
  }
  if (code !== 0) {
    console.error(`\n${file} failed with exit code ${code}. Stopping.`);
    process.exit(1);
  }
}

// Keep the pool's canonicity consistent as new songs land, so the sampler is
// never weighting on scores computed from a smaller corpus.
if (!hitQuota) {
  console.log('\nRefreshing canonicity across all files...');
  await new Promise((resolve) => {
    spawn(process.execPath, [path.join(ROOT, 'scripts', 'apply-canonicity.mjs')], {
      cwd: ROOT, stdio: 'inherit',
    }).on('close', resolve);
  });
}

const pool = await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] });
console.log(`\n=== pool is now ${(pool.songs ?? []).length} playable songs ===`);

process.exit(hitQuota ? EXIT_RATE_LIMITED : 0);
