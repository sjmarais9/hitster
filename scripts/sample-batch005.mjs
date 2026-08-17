// Draws the batch-005 diagnostic of 15 August.
//
// The batch was hand-tagged in one sitting and came out 78% `deep`, 95%
// `adults`. Only two of its songs have since been asked about blind, and both
// came back better known than the tag said - Da Doo Ron Ron and You Are the
// Sunshine of My Life, both written down as `deep`. Two songs prove nothing,
// which is what this is for.
//
// Twenty `deep` songs to test the tilt, and ten `familiar` ones as a control.
// A sample of only `deep` songs can move in one direction and no other, so it
// cannot tell over-tagging from a generous mood. The control can: if it holds
// while the `deep` twenty rise, the tilt is real.
//
// Seeded, so the same sample can be drawn again.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSongs } from './lib/songs-file.mjs';
import { reviewKey, REVIEWED } from './lib/reviewed.mjs';

const DIR = join(import.meta.dirname, '..', 'data');
const SEED = 20260815;

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

const { songs } = await readSongs(join(DIR, 'batch-005.seed.json'));
// Nothing already judged: asking twice measures memory, not the song.
const fresh = songs.filter((s) => !REVIEWED[reviewKey(s)]);

const next = rng(SEED);
const pick = (tag, n) => shuffle(fresh.filter((s) => s.familiarity === tag), next).slice(0, n)
  .map((s) => ({
    stratum: tag === 'deep' ? 'suspect' : 'control',
    artist: s.artist, title: s.title, year: s.year,
    canonicity: s.canonicity, was: { familiarity: s.familiarity, skew: s.skew },
  }));

const asked = shuffle([...pick('deep', 20), ...pick('familiar', 10)], next);
await writeFile(join(DIR, 'batch005-diagnostic-2026-08-15.json'),
  `${JSON.stringify({ seed: SEED, asked }, null, 2)}\n`, 'utf8');

console.log(`${asked.length} songs drawn from ${fresh.length} unreviewed in batch-005\n`);
asked.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.artist} - ${s.title}  (${s.year})`));
console.log('\nstrata:');
for (const k of ['suspect', 'control']) console.log(`  ${k.padEnd(9)}${asked.filter((s) => s.stratum === k).length}`);
