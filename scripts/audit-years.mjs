#!/usr/bin/env node
//
// Audits every year we hold against MusicBrainz:
//
//   node scripts/audit-years.mjs [--limit 500]
//
// Answers two questions that have both been asserted without evidence.
//
// 1. HOW GOOD IS THE GENERATOR'S YEAR FILTER?
//    batch-006 accepts a MusicBrainz year only when it agrees with the decade
//    the song's playlists place it in. MusicBrainz alone tested at 84% exact.
//    The claim that the cross-check pushes that much higher has never been
//    measured. Running the same filter over songs whose years we already know
//    measures it directly.
//
// 2. HOW GOOD ARE THE HAND-WRITTEN YEARS?
//    Roughly 1,400 songs have years written from memory. The only check ever
//    applied fires when Spotify dates a track EARLIER than we do, which caught
//    exactly one error. The true rate is unknown, and year is the one field
//    that genuinely breaks the game when wrong.
//
// A disagreement does not prove us wrong - MusicBrainz dates reissues late,
// which is why the cross-check exists. Disagreements are reported for judgement
// rather than corrected automatically. This script writes nothing.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';
import { readSongs } from './lib/songs-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'year-audit.json');

const UA = 'HitsterPool/1.0 (sjmarais@inrangegolf.com)';
const PAUSE_MS = 1100;
const CHECKPOINT_EVERY = 50;

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

const DECADE_YEARS = {
  '1950s': [1950, 1959], '1960s': [1960, 1969], '1970s': [1970, 1979],
  '1980s': [1980, 1989], '1990s': [1990, 1999], '2000s': [2000, 2009],
  '2010s': [2010, 2019], '2020s': [2020, 2029],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Identical to the generator's, deliberately. Auditing a different lookup would
// measure something other than the thing in use.
async function yearOf(artist, title) {
  const q = `artist:"${artist.replace(/"/g, '')}" AND releasegroup:"${title.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(q)}&fmt=json&limit=10`;

  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!response.ok) return null;
    const body = await response.json();

    const wantTitle = normalise(title);
    const wantArtist = normalise(artist);

    const years = (body['release-groups'] ?? [])
      .filter((g) => {
        if (normalise(g.title ?? '') !== wantTitle) return false;
        const credited = (g['artist-credit'] ?? []).map((a) => normalise(a.name ?? ''));
        if (!credited.some((a) => a === wantArtist)) return false;
        return !(g['secondary-types'] ?? []).some((t) => /compilation|live|remix|dj-mix/i.test(t));
      })
      .map((g) => Number(String(g['first-release-date'] ?? '').slice(0, 4)))
      .filter((y) => y > 1900 && y < 2030);

    return years.length ? Math.min(...years) : null;
  } catch {
    return null;
  }
}

function crowdDecade(entry) {
  if (!entry) return null;
  const counts = Object.entries(entry.decades ?? {});
  if (!counts.length) return null;
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const [decade, n] = counts.sort((a, b) => b[1] - a[1])[0];
  return n / total >= 0.4 ? decade : null;
}

// --- gather ------------------------------------------------------------------

const index = JSON.parse(await readFile(path.join(ROOT, 'data', 'canonicity.json'), 'utf8')).tracks ?? {};

const songs = [];
const seen = new Set();
for (const file of ['data/songs.json', 'data/batch-002.seed.json', 'data/batch-003.seed.json',
  'data/batch-004.seed.json', 'data/batch-005.seed.json']) {
  const doc = await readSongs(path.resolve(ROOT, file), { songs: [] });
  for (const song of doc.songs ?? []) {
    const key = `${normalise(song.artist)}|${normalise(song.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push({ ...song, key, source: file });
  }
}

const previous = await (async () => {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return { results: {} }; }
})();
const results = previous.results ?? {};

const todo = songs.filter((s) => !(s.key in results)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`${songs.length} hand-written songs, ${Object.keys(results).length} already audited, ${todo.length} to check`);
console.log(`about ${Math.round((todo.length * PAUSE_MS) / 60000)} minutes at MusicBrainz's requested rate\n`);

// --- check -------------------------------------------------------------------

let done = 0;
for (const song of todo) {
  const mb = await yearOf(song.artist, song.title);
  await sleep(PAUSE_MS);

  const crowd = crowdDecade(index[song.key]);
  const range = crowd ? DECADE_YEARS[crowd] : null;
  // Would the generator have accepted this MusicBrainz year?
  const accepted = mb !== null && range !== null && mb >= range[0] && mb <= range[1];

  results[song.key] = {
    artist: song.artist, title: song.title, ours: song.year,
    mb, crowd, accepted, gap: mb === null ? null : mb - song.year,
  };

  if (++done % CHECKPOINT_EVERY === 0) {
    await writeFile(OUT, JSON.stringify({ results }, null, 2) + '\n', 'utf8');
    process.stdout.write(`\r  ${done}/${todo.length}`);
  }
}
await writeFile(OUT, JSON.stringify({ results }, null, 2) + '\n', 'utf8');

// --- report ------------------------------------------------------------------

const all = Object.values(results);
const withMb = all.filter((r) => r.mb !== null);
const acceptedSet = all.filter((r) => r.accepted);

const exact = (xs) => xs.filter((r) => r.gap === 0).length;
const within1 = (xs) => xs.filter((r) => Math.abs(r.gap) <= 1).length;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

console.log(`\n\n=== 1. THE GENERATOR'S YEAR FILTER ===`);
console.log(`MusicBrainz returned a year for ${withMb.length} of ${all.length} (${pct(withMb.length, all.length)})`);
console.log(`  raw, no cross-check:  ${pct(exact(withMb), withMb.length)} exact, ${pct(within1(withMb), withMb.length)} within a year`);
console.log(`  after the cross-check: ${acceptedSet.length} accepted (${pct(acceptedSet.length, all.length)} of all)`);
console.log(`     of those accepted:  ${pct(exact(acceptedSet), acceptedSet.length)} exact, ${pct(within1(acceptedSet), acceptedSet.length)} within a year`);
console.log(`\n  This is the number batch-006's years should be trusted at.`);

console.log(`\n=== 2. OUR HAND-WRITTEN YEARS ===`);
// Where MusicBrainz agrees with the crowd's decade but not with us, we are the
// most likely to be the ones who are wrong.
const suspect = acceptedSet.filter((r) => Math.abs(r.gap) >= 2);
console.log(`${suspect.length} songs where a cross-checked MusicBrainz year disagrees with ours by 2+`);
console.log(`  that is ${pct(suspect.length, acceptedSet.length)} of the songs we could check confidently`);
if (suspect.length) {
  console.log(`\n  worst offenders, ours vs MusicBrainz:`);
  for (const r of suspect.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 25)) {
    console.log(`    ${`${r.artist} - ${r.title}`.slice(0, 46).padEnd(46)} ours ${r.ours}  MB ${r.mb}  (${r.gap > 0 ? '+' : ''}${r.gap})`);
  }
}

console.log(`\nWrote ${path.relative(ROOT, OUT)} - every result, for follow-up.`);
