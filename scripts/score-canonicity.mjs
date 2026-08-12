#!/usr/bin/env node
//
// Validates the external canonicity signals against our hand-assigned
// familiarity tags:
//
//   node scripts/score-canonicity.mjs
//
// Two independent sources:
//   Deezer   how many playlists a track appears on   (curation)
//   Last.fm  how many distinct people scrobbled it   (breadth of listening)
//
// Everything is compared WITHIN DECADE. Raw counts across decades are
// meaningless: a 1967 song and a 2015 song face completely different playlist
// populations and completely different scrobbling userbases. Comparing them
// directly measures the platform, not the song.
//
// Three questions, in order:
//   1. Do the sources agree with each other? Two unrelated methods agreeing is
//      much stronger evidence than either alone.
//   2. Do they agree with our tags? If `standard` songs do not rank above
//      `deep` ones within their own decade, the signal is not usable.
//   3. Where do they disagree with us, and is the data or the tag wrong?
//
// Writes nothing. This decides whether the data is worth using at all.

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

const deezer = (await readJson('data/canonicity.json', { tracks: {} })).tracks ?? {};
const lastfm = (await readJson('data/lastfm.json', { tracks: {} })).tracks ?? {};

const songs = [];
for (const file of ['data/songs.json', 'data/batch-003.seed.json', 'data/batch-004.seed.json', 'data/batch-005.seed.json']) {
  songs.push(...((await readJson(file, { songs: [] })).songs ?? []));
}

const seen = new Set();
const pool = songs.filter((s) => {
  const k = `${s.artist}|${s.title}`.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Join. Absence is data: a song on no playlist and with no listeners is obscure.
const joined = pool.map((s) => ({
  ...s,
  playlists: deezer[`${normalise(s.artist)}|${normalise(s.title)}`]?.n ?? 0,
  listeners: lastfm[`${s.artist}|${s.title}`.toLowerCase()]?.listeners ?? null,
}));

const withLastfm = joined.filter((s) => s.listeners !== null);

console.log(`pool ${pool.length} songs`);
console.log(`  on at least one playlist: ${joined.filter((s) => s.playlists > 0).length}`);
console.log(`  with Last.fm data fetched: ${withLastfm.length}`);

/** Percentile rank of each song within its own decade, 0-100. */
function percentileByDecade(list, valueOf) {
  const byDecade = new Map();
  for (const s of list) {
    if (!byDecade.has(s.decade)) byDecade.set(s.decade, []);
    byDecade.get(s.decade).push(s);
  }
  const out = new Map();
  for (const [, group] of byDecade) {
    const sorted = [...group].sort((a, b) => valueOf(a) - valueOf(b));
    sorted.forEach((s, i) => out.set(s, (i / Math.max(1, sorted.length - 1)) * 100));
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// --- 1. do the two sources agree with each other? ----------------------------

if (withLastfm.length > 30) {
  const pd = percentileByDecade(withLastfm, (s) => s.playlists);
  const pl = percentileByDecade(withLastfm, (s) => s.listeners);

  // Spearman: Pearson correlation of the two percentile ranks.
  const xs = withLastfm.map((s) => pd.get(s));
  const ys = withLastfm.map((s) => pl.get(s));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const rho = num / Math.sqrt(dx * dy);
  console.log(`\n1. DO THE SOURCES AGREE WITH EACH OTHER?`);
  console.log(`   rank correlation, within decade: ${rho.toFixed(2)}`);
  console.log(`   ${rho > 0.6 ? 'Strong. Two unrelated methods pointing the same way.'
    : rho > 0.3 ? 'Moderate. They overlap but measure different things.'
      : 'Weak. At least one is not measuring canonicity.'}`);
} else {
  console.log('\n1. Not enough Last.fm data yet to compare sources.');
}

// --- 2. do they agree with our tags? -----------------------------------------

console.log(`\n2. DO THEY AGREE WITH OUR TAGS? (median percentile within decade)`);

for (const [label, list, valueOf] of [
  ['Deezer playlists', joined, (s) => s.playlists],
  ['Last.fm listeners', withLastfm, (s) => s.listeners],
]) {
  if (list.length < 30) continue;
  const pct = percentileByDecade(list, valueOf);
  console.log(`\n   ${label}`);
  console.log(`     tier        n     median percentile`);
  for (const tier of ['standard', 'familiar', 'deep']) {
    const group = list.filter((s) => s.familiarity === tier);
    if (!group.length) continue;
    const m = median(group.map((s) => pct.get(s)));
    const bar = '#'.repeat(Math.round((m ?? 0) / 4));
    console.log(`     ${tier.padEnd(10)} ${String(group.length).padStart(5)}   ${(m ?? 0).toFixed(0).padStart(3)}  ${bar}`);
  }
}
console.log(`\n   Usable only if the percentile falls from standard to deep.`);

// --- 3. where do they disagree with us? --------------------------------------

const pd = percentileByDecade(joined, (s) => s.playlists);
const deepButPopular = joined
  .filter((s) => s.familiarity === 'deep' && pd.get(s) >= 92 && s.playlists >= 5)
  .sort((a, b) => b.playlists - a.playlists);

const standardButObscure = joined
  .filter((s) => s.familiarity === 'standard' && pd.get(s) <= 40)
  .sort((a, b) => a.playlists - b.playlists);

console.log(`\n3. DISAGREEMENTS`);
console.log(`\n   Tagged deep, top decile of their decade: ${deepButPopular.length}`);
for (const s of deepButPopular.slice(0, 15)) {
  console.log(`     ${String(s.playlists).padStart(3)} playlists  ${s.artist} - ${s.title} (${s.year})`);
}
console.log(`\n   Tagged standard, bottom 40% of their decade: ${standardButObscure.length}`);
for (const s of standardButObscure.slice(0, 15)) {
  console.log(`     ${String(s.playlists).padStart(3)} playlists  ${s.artist} - ${s.title} (${s.year})`);
}

// --- known blind spot ---------------------------------------------------------

const SA = ['Mandoza', 'Master KG', 'Johnny Clegg', 'Brenda Fassie', 'Mango Groove', 'Tyla',
  'Ladysmith', 'Yvonne Chaka Chaka', 'Lucky Dube', 'Freshlyground', 'Cassper', 'Nasty C',
  'Sho Madjozi', 'Kabza', 'Uncle Waffles', 'TKZee', 'Zola', 'Mafikizolo', 'Miriam Makeba'];
const sa = joined.filter((s) => SA.some((a) => s.artist.includes(a)));
console.log(`\n   South African songs: ${sa.length}, of which ${sa.filter((s) => s.playlists > 0).length} appear on any playlist`);
console.log(`   This is the blind spot no external source fixes. Local tags must win here.`);
