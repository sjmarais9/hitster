// Applies the skew review of 15 August.
//
// SHARED rose from 65 to 80, which on its own changes nothing: batch 006 is the
// last batch, and everything already tagged was tagged under the old threshold.
// So the songs the new threshold disagrees with are re-seeded here.
//
// Only in the direction the change implies. A pre-2005 song tagged `even` whose
// canonicity now falls short becomes `adults`, and nothing else moves. The
// first attempt at this re-ran the whole seed instead, which flipped seven
// songs the earlier review had corrected by hand back to what the machine
// thought - so it also repairs those, and every judgement now lives in
// lib/reviewed.mjs where a test defends it.
//
// The pool matters most: it is what the app deals tonight. But it mixes 292
// songs tagged by hand with two thousand promoted out of the batches, and
// nothing in the record says which is which. A promoted song still exists in
// the batch it came from, so that is the test. Untraceable means someone
// decided, and a rule has no business overwriting a judgement.
//
// Re-running this changes nothing.
import { join } from 'node:path';
// A path, not a URL: writeSongs builds its temp file by interpolation.
import { readSongs, writeSongs } from './lib/songs-file.mjs';
import { SHARED } from './lib/seeds.mjs';
import { REVIEWED, reviewKey, verdictFor } from './lib/reviewed.mjs';

const DIR = join(import.meta.dirname, '..', 'data');
const BATCHES = ['batch-002', 'batch-003', 'batch-004', 'batch-005', 'batch-006']
  .map((b) => `${b}.seed.json`);

const dry = process.argv.includes('--dry-run');
const counts = { judged: 0, reseeded: 0, spared: 0 };
const seen = new Set();

const apply = async (file, machineTagged) => {
  const path = join(DIR, file);
  const doc = await readSongs(path);

  doc.songs = doc.songs.map((song) => {
    const verdict = verdictFor(song);
    if (verdict) {
      seen.add(reviewKey(song));
      const next = { ...song, skew: verdict.skew };
      if (verdict.familiarity) next.familiarity = verdict.familiarity;
      if (next.skew !== song.skew || next.familiarity !== song.familiarity) counts.judged++;
      return next;
    }

    // The one move the new threshold implies, and only that one.
    if (song.skew !== 'even' || song.year >= 2005) return song;
    if (song.canonicity == null || song.canonicity >= SHARED) return song;
    if (!machineTagged(song)) { counts.spared++; return song; }
    counts.reseeded++;
    return { ...song, skew: 'adults' };
  });

  if (!dry) await writeSongs(path, doc);
  return doc.songs;
};

// The batches are machine-seeded end to end.
const seeded = new Set();
for (const file of BATCHES) {
  for (const song of await apply(file, () => true)) seeded.add(reviewKey(song));
}

// The pool is not, so each song has to earn the correction.
await apply('songs.json', (song) => seeded.has(reviewKey(song)));

console.log(`${counts.judged} tags corrected to match a review`);
console.log(`${counts.reseeded} machine-tagged songs moved to adults at the new threshold of ${SHARED}`);
console.log(`${counts.spared} hand-tagged songs left alone despite falling short`);

const missing = Object.keys(REVIEWED).filter((k) => !seen.has(k));
if (missing.length) console.log(`\n${missing.length} reviewed songs are not in the data:\n  ${missing.join('\n  ')}`);
if (dry) console.log('\n--dry-run: nothing written.');
