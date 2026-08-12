#!/usr/bin/env node
//
// Consistency checks over the pool:
//
//   node scripts/check-tags.mjs
//
// This replaces the popularity cross-check, which cannot exist. Spotify does
// not return `popularity` to this app - the field is absent from search results
// and from GET /tracks/{id}, and GET /tracks?ids= is 403 - so there is no
// external opinion to check our familiarity tags against.
//
// What is left is internal consistency, which is worth more than it sounds.
// It cannot tell us a tag is *wrong*. It can tell us a tag is *inconsistent*
// with the rules in docs/tagging.md or with how the same artist was treated
// elsewhere, and across dozens of batches written from memory, inconsistency is
// the failure that actually happens.
//
// Every flag is a question, not a verdict. No network, no auth.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = {
  decade: { '1950s': 1, '1960s': 4, '1970s': 12, '1980s': 18, '1990s': 24, '2000s': 18, '2010s': 15, '2020s': 8 },
  rockShare: 45,
  saShare: 5,
};

// Maintained by hand, because "is this artist South African" is not derivable
// from anything in the schema. Add to it as batches introduce new ones.
const SA_ARTISTS = [
  'Johnny Clegg', 'Mango Groove', 'Springbok Nude Girls', 'Just Jinger', 'Freshlyground',
  'Black Coffee', 'Prime Circle', 'Seether', 'Tyla', 'Mandoza', 'Master KG',
  'Brenda Fassie', 'Yvonne Chaka Chaka', 'Ladysmith Black Mambazo', 'Lucky Dube',
  'Boom Shaka', 'TKZee', 'Bongo Maffin', 'Sho Madjozi', 'Nasty C', 'Miriam Makeba',
  'Juluka', 'Stimela', 'Mdu', 'Zola', 'Mafikizolo', 'Cassper Nyovest', 'Kabza De Small',
  'Uncle Waffles', 'Vusi Mahlasela', 'Rodriguez',
];
const ROCK = /rock|punk|metal|grunge|britpop|indie|new wave|post-punk/i;

const file = process.argv[2] ?? 'data/songs.json';
const doc = JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
const songs = doc.songs ?? [];

const flags = [];
const flag = (kind, song, why) => flags.push({ kind, line: `${song.artist} - ${song.title} (${song.year})`, why });

// A seed batch has null URIs by design; only the pool is expected to have them.
// Without this the checker reports every song in a fresh batch as broken.
const isSeed = songs.every((song) => song.spotify_uri === null);

// --- integrity ---------------------------------------------------------------

for (const song of songs) {
  if (`${Math.floor(song.year / 10) * 10}s` !== song.decade) {
    flag('integrity', song, `decade ${song.decade} does not match year ${song.year}`);
  }
  if (!song.familiarity || !song.skew) {
    flag('integrity', song, 'missing familiarity or skew');
  }
  if (!isSeed && !song.spotify_uri) {
    flag('integrity', song, 'in the pool without a URI - should not be playable');
  }
}

const seen = new Map();
for (const song of songs) {
  const key = `${song.artist}|${song.title}`.toLowerCase();
  if (seen.has(key)) flag('integrity', song, `duplicate of the same artist and title (${seen.get(key)})`);
  else seen.set(key, song.year);
}

// --- rules from docs/tagging.md ----------------------------------------------

for (const song of songs) {
  // Rule 3: a pre-1990 song being famous does not mean the children know it.
  // The reverse - a pre-1990 song the children own outright - is rare enough to
  // be worth a second look every time.
  if (song.year < 1990 && song.skew === 'kids') {
    flag('rule 3', song, 'pre-1990 and tagged kids, which rule 3 says is unusual');
  }

  // Rule 4: recent chart pop is less familiar here than streaming suggests.
  if (song.year >= 2020 && song.familiarity === 'standard') {
    flag('rule 4', song, 'from the 2020s and tagged standard, which rule 4 says to be conservative about');
  }

  // A 2020s song the parents own and the children do not is worth checking.
  if (song.year >= 2020 && song.skew === 'adults') {
    flag('sanity', song, 'from the 2020s but tagged adults');
  }
}

// --- one artist, wildly different tags ---------------------------------------

const byArtist = new Map();
for (const song of songs) {
  if (!byArtist.has(song.artist)) byArtist.set(song.artist, []);
  byArtist.get(song.artist).push(song);
}

for (const [artist, theirs] of byArtist) {
  if (theirs.length < 3) continue;
  const tiers = new Set(theirs.map((s) => s.familiarity));
  if (tiers.has('standard') && tiers.has('deep')) {
    flags.push({
      kind: 'spread',
      line: `${artist} (${theirs.length} songs)`,
      why: `spans standard to deep: ${theirs.map((s) => `${s.title} [${s.familiarity}]`).join(', ')}`,
    });
  }
}

// --- distribution ------------------------------------------------------------

const share = (n) => `${((n / songs.length) * 100).toFixed(1)}%`;
const counts = (fn) => songs.reduce((acc, s) => ({ ...acc, [fn(s)]: (acc[fn(s)] ?? 0) + 1 }), {});

console.log(`${file}: ${songs.length} songs\n`);

console.log('decade      count   share   target');
const decades = counts((s) => s.decade);
for (const key of Object.keys(TARGETS.decade)) {
  const n = decades[key] ?? 0;
  const target = TARGETS.decade[key];
  const drift = Math.abs((n / songs.length) * 100 - target) > 5 ? '  <-- drifting' : '';
  console.log(`  ${key}   ${String(n).padStart(5)}  ${share(n).padStart(6)}  ${String(target).padStart(5)}%${drift}`);
}

for (const [label, fn] of [['familiarity', (s) => s.familiarity], ['skew', (s) => s.skew]]) {
  console.log(`\n${label}`);
  for (const [key, n] of Object.entries(counts(fn)).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(key).padEnd(10)} ${String(n).padStart(5)}  ${share(n)}`);
  }
}

const rock = songs.filter((s) => s.genres?.some((g) => ROCK.test(g))).length;
const sa = songs.filter((s) => SA_ARTISTS.some((a) => s.artist.includes(a))).length;
console.log(`\nrock/alternative  ${rock}  ${share(rock)}  target ~${TARGETS.rockShare}%`);
console.log(`south african     ${sa}  ${share(sa)}  cap ${TARGETS.saShare}%${(sa / songs.length) * 100 > TARGETS.saShare ? '  <-- over' : ''}`);

// --- report ------------------------------------------------------------------

const order = ['integrity', 'rule 3', 'rule 4', 'sanity', 'spread'];
flags.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

console.log(`\n${flags.length} flag(s)${flags.length ? ', most serious first' : ''}\n`);
for (const f of flags) {
  console.log(`  [${f.kind}] ${f.line}`);
  console.log(`      ${f.why}`);
}
if (flags.length === 0) console.log('  none');
