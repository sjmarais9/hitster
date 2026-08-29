#!/usr/bin/env node
//
// Removes songs that are popular somewhere else:
//
//   node scripts/apply-exclusions.mjs [--dry-run]
//
// The list lives in lib/excluded.mjs, which explains why each kind is there.
// This only carries it out.
//
// Both the pool and the batch seeds are pruned. The pool because that is what
// the phone downloads; the seeds because canonicity is a percentile computed
// over every song in those files whether it was ever imported or not, so
// leaving 160 high-scoring tracks in them would go on lifting the percentile of
// everything beneath them for no purpose.
//
// import-songs.mjs consults the same list, so a pruned song cannot walk back in
// on the next run.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs, writeSongs } from './lib/songs-file.mjs';
import { isExcluded } from './lib/excluded.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  'data/songs.json',
  'data/batch-002.seed.json',
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

const dryRun = process.argv.includes('--dry-run');

// Prunes the pool and leaves the batch seeds alone.
//
// generate-from-index.mjs checkpoints into batch-006.seed.json every 25 songs,
// so writing that file underneath a run in progress loses whatever it has
// accepted since its last save. The pool is not touched by generation and is
// safe to prune at any time - it is also the only one of the two the phone
// downloads, so this is the half that changes a game tonight.
//
// Run again without the flag once generation has finished: the seeds still need
// pruning, or their percentiles go on counting songs the pool no longer holds.
const poolOnly = process.argv.includes('--pool-only');
let total = 0;

for (const file of poolOnly ? TARGETS.slice(0, 1) : TARGETS) {
  const full = path.resolve(ROOT, file);
  const doc = await readSongs(full, null);
  if (!doc) continue;

  const before = doc.songs?.length ?? 0;
  const removed = (doc.songs ?? []).filter(isExcluded);
  if (removed.length === 0) {
    console.log(`${file.padEnd(30)} nothing to remove`);
    continue;
  }

  doc.songs = (doc.songs ?? []).filter((s) => !isExcluded(s));
  if (doc.meta && typeof doc.meta.count === 'number') doc.meta.count = doc.songs.length;
  total += removed.length;
  console.log(`${file.padEnd(30)} ${before} -> ${doc.songs.length}  (${removed.length} removed)`);

  if (!dryRun) await writeSongs(full, doc);
}

console.log(`\n${total} record(s) ${dryRun ? 'would be' : ''} removed.`);
if (dryRun) console.log('Dry run: nothing written.');
else console.log('Re-run apply-canonicity.mjs: the percentiles have changed underneath everything.');
