// Everything we have, counted: node scripts/stats.mjs
//
// Two populations that should never be added together without saying so. The
// playable pool is data/songs.json - every entry has a verified Spotify URI and
// can be dealt tonight. The queue is the batch files, which are real songs with
// real tags but no URI yet, and cannot be dealt until the import has matched
// them. Reporting one total for both is how a pool of 292 gets described as
// 7,500.
//
// A batch is not emptied when it imports; it stays on disk as the record of
// what was tagged and reviewed. batch-002 is entirely inside songs.json
// already. So the queue has to be counted as the batch songs the pool does not
// yet hold, or every imported song is counted twice - which the first version
// of this script duly did.

import { readSongs } from './lib/songs-file.mjs';
import { familyOf, GENRE_FAMILIES } from '../src/scoring.js';

const POOL = 'data/songs.json';
const QUEUE = [
  'data/batch-002.seed.json',
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

const DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

async function load(file) {
  const doc = await readSongs(file, null);
  return doc ? (doc.songs ?? []) : [];
}

const identity = (song) => `${song.artist}|${song.title}`.toLowerCase();

const pool = await load(POOL);
const held = new Set(pool.map(identity));

const queue = [];
const perFile = [];
for (const file of QUEUE) {
  const songs = await load(file);
  const waiting = songs.filter((s) => !held.has(identity(s)));
  perFile.push([file.replace('data/', '').replace('.seed.json', ''), songs, waiting.length]);
  queue.push(...waiting);
}
const all = [...pool, ...queue];

const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : '-');
const count = (songs, key) => songs.reduce((acc, s) => {
  const k = typeof key === 'function' ? key(s) : s[key];
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});

/** A row of counts with percentages, over a fixed set of keys. */
function table(title, keys, groups, key, labelFor = (k) => k) {
  console.log(`\n${title}`);
  const width = Math.max(...keys.map((k) => labelFor(k).length)) + 2;
  console.log(''.padEnd(width) + groups.map(([name]) => name.padStart(18)).join(''));

  const tallies = groups.map(([, songs]) => [count(songs, key), songs.length]);
  for (const k of keys) {
    const cells = tallies.map(([c, total]) => {
      const n = c[k] ?? 0;
      return `${n} (${pct(n, total)})`.padStart(18);
    });
    console.log(labelFor(k).padEnd(width) + cells.join(''));
  }
}

console.log('='.repeat(72));
console.log('  HITSTER SONG POOL');
console.log('='.repeat(72));

console.log(`\n  playable now (verified Spotify URI)   ${String(pool.length).padStart(6)}`);
console.log(`  queued for import (no URI yet)        ${String(queue.length).padStart(6)}`);
console.log(`  ${'-'.repeat(38)}`);
console.log(`  distinct songs held                   ${String(all.length).padStart(6)}`);

const noUri = pool.filter((s) => !s.spotify_uri).length;
if (noUri) console.log(`\n  WARNING: ${noUri} songs in the playable pool have no URI`);

console.log('\n\nBY FILE');
console.log(`  ${''.padEnd(24)}${'tagged'.padStart(8)}${'still to import'.padStart(18)}`);
console.log(`  ${'songs.json (playable)'.padEnd(24)}${String(pool.length).padStart(8)}${'-'.padStart(18)}`);
for (const [name, songs, waiting] of perFile) {
  const note = waiting === 0 ? 'all imported' : String(waiting);
  console.log(`  ${name.padEnd(24)}${String(songs.length).padStart(8)}${note.padStart(18)}`);
}

const groups = [['playable', pool], ['queued', queue], ['everything', all]];

table('BY DECADE', DECADES, groups, 'decade');
table('BY FAMILIARITY', ['standard', 'familiar', 'deep'], groups, 'familiarity');
table('BY SKEW', ['adults', 'even', 'kids'], groups, 'skew');
table('BY GENRE FAMILY', Object.keys(GENRE_FAMILIES), groups, familyOf,
  (k) => GENRE_FAMILIES[k].label);

// --- how much of this is measured rather than asserted -----------------------

console.log('\n\nDATA QUALITY');

const measured = all.filter((s) => s.canonicity !== null && s.canonicity !== undefined);
console.log(`  canonicity measured        ${String(measured.length).padStart(6)}  (${pct(measured.length, all.length)})`);

const noGenre = all.filter((s) => !s.genres?.length).length;
console.log(`  missing genres             ${String(noGenre).padStart(6)}  (${pct(noGenre, all.length)})`);

const badYear = all.filter((s) => !s.year || `${Math.floor(s.year / 10) * 10}s` !== s.decade).length;
console.log(`  year disagrees with decade ${String(badYear).padStart(6)}  (${pct(badYear, all.length)})`);

// Duplicates across the whole corpus, which is what the generator's `known` set
// is meant to prevent and worth checking rather than assuming.
const seen = new Map();
let dupes = 0;
for (const s of all) {
  const key = `${s.artist}|${s.title}`.toLowerCase();
  if (seen.has(key)) dupes++;
  else seen.set(key, s);
}
console.log(`  duplicate artist + title   ${String(dupes).padStart(6)}  (${pct(dupes, all.length)})`);

// --- the thing the sampler actually cares about ------------------------------

console.log('\n  the children can be dealt:');
const shareable = all.filter((s) => s.skew !== 'adults');
console.log(`    ${shareable.length} songs (${pct(shareable.length, all.length)}), of which ` +
  `${shareable.filter((s) => s.year < 2000).length} predate 2000`);

const standards = all.filter((s) => s.familiarity === 'standard');
console.log('\n  songs the table should shout at:');
console.log(`    ${standards.length} tagged standard (${pct(standards.length, all.length)})`);
const byDec = count(standards, 'decade');
console.log('    ' + DECADES.filter((d) => byDec[d]).map((d) => `${d} ${byDec[d]}`).join('  '));

console.log();
