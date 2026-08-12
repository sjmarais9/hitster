#!/usr/bin/env node
//
// Builds a song batch from the playlist index instead of from memory:
//
//   node scripts/generate-from-index.mjs [--limit 2000] [--min-playlists 5]
//
// Every field is derived from data rather than written by hand. That matters
// most for `year`: hand-written years are the largest correctness risk in this
// project, and the one error that genuinely breaks the game. Black Coffee's
// Superman was two years out until Spotify happened to contradict it.
//
// Year comes from MusicBrainz release-groups, which tested at 84% exact and 92%
// within a year on songs we already knew. That is not good enough on its own,
// so every year is cross-checked against an independent signal: which
// era-themed playlists the song actually appears on. A song MusicBrainz dates
// to 2011 that lives on 1960s playlists is rejected rather than guessed at.
//
// Rejecting candidates is cheap. There are roughly 15,000 clean ones and we
// need a few thousand, so discarding everything doubtful costs nothing and buys
// the one field that must not be wrong.
//
// Resumable: already-processed candidates are skipped and the batch is written
// every 25 songs.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';
import { writeSongs, readSongs } from './lib/songs-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'batch-006.seed.json');

const UA = 'HitsterPool/1.0 (sjmarais@inrangegolf.com)';
const PAUSE_MS = 1100;            // MusicBrainz asks for one request per second
const CHECKPOINT_EVERY = 25;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const LIMIT = flag('limit', Infinity);
const MIN_PLAYLISTS = flag('min-playlists', 5);

// Titles that are not the song we want, however well they match.
const JUNK = /\bkaraoke\b|\bmade popular by\b|\btribute\b|\bin the style of\b|\blive\b(?!\s*(and|to|at last))|\bremix\b|\bedit\b|\bmix\)|\bcover\b|\binstrumental\b|\bbacking track\b|\bremaster(ed)?\b/i;

const DECADE_YEARS = {
  '1950s': [1950, 1959], '1960s': [1960, 1969], '1970s': [1970, 1979],
  '1980s': [1980, 1989], '1990s': [1990, 1999], '2000s': [2000, 2009],
  '2010s': [2010, 2019], '2020s': [2020, 2029],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f) => JSON.parse(await readFile(path.resolve(ROOT, f), 'utf8'));

/** Original release year from MusicBrainz release-groups, or null. */
async function yearOf(artist, title) {
  const q = `artist:"${artist.replace(/"/g, '')}" AND releasegroup:"${title.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(q)}&fmt=json&limit=10`;

  let body;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }

  const wantTitle = normalise(title);
  const wantArtist = normalise(artist);

  const years = (body['release-groups'] ?? [])
    .filter((g) => {
      if (normalise(g.title ?? '') !== wantTitle) return false;
      const credited = (g['artist-credit'] ?? []).map((a) => normalise(a.name ?? ''));
      if (!credited.some((a) => a === wantArtist)) return false;
      // Compilations, live albums and remix collections are what dated the
      // first attempt twenty years late.
      return !(g['secondary-types'] ?? []).some((t) => /compilation|live|remix|dj-mix/i.test(t));
    })
    .map((g) => Number(String(g['first-release-date'] ?? '').slice(0, 4)))
    .filter((y) => y > 1900 && y < 2030);

  return years.length ? Math.min(...years) : null;
}

/**
 * The era the crowd puts this song in, from which decade-themed playlists it
 * appears on. Independent of MusicBrainz, which is the point.
 */
function crowdDecade(entry) {
  const counts = Object.entries(entry.decades ?? {});
  if (!counts.length) return null;
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const [decade, n] = counts.sort((a, b) => b[1] - a[1])[0];
  // A weak plurality is not evidence. Two decades splitting the vote tells us
  // nothing about which is right.
  return n / total >= 0.4 ? decade : null;
}

/** Up to two genres, from the themes the song actually appeared on. */
function genresOf(entry) {
  const counts = Object.entries(entry.genres ?? {});
  if (!counts.length) return ['pop'];
  return counts.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
}

/**
 * Seeds, not judgements. familiarity is set from measured canonicity, and skew
 * from the year, using the relationship measured across the existing pool:
 * essentially no pre-2000 song is kids-skewed, 2010s is about half, 2020s most.
 * Both are starting points the review and the sampler can move.
 */
const familiarityFor = (percentile) =>
  (percentile >= 85 ? 'standard' : percentile >= 45 ? 'familiar' : 'deep');

const skewFor = (year) => (year < 2005 ? 'adults' : year < 2015 ? 'even' : 'kids');

async function main() {
  const index = (await readJson('data/canonicity.json')).tracks ?? {};

  // Everything we already have, so we do not regenerate it.
  const known = new Set();
  for (const file of ['data/songs.json', 'data/batch-002.seed.json', 'data/batch-003.seed.json',
    'data/batch-004.seed.json', 'data/batch-005.seed.json']) {
    const doc = await readSongs(path.resolve(ROOT, file), { songs: [] });
    for (const s of doc.songs ?? []) known.add(`${normalise(s.artist)}|${normalise(s.title)}`);
  }

  // Resume whatever a previous run produced.
  const existing = await readSongs(OUT, { songs: [] });
  const produced = existing.songs ?? [];
  for (const s of produced) known.add(`${normalise(s.artist)}|${normalise(s.title)}`);

  const candidates = Object.entries(index)
    .filter(([key, e]) => e.n >= MIN_PLAYLISTS && !JUNK.test(e.title) && !known.has(key))
    .sort((a, b) => b[1].n - a[1].n)          // most canonical first
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log(`${candidates.length} candidates (on ${MIN_PLAYLISTS}+ playlists, not junk, not already held)`);
  console.log(`${produced.length} already generated\n`);
  if (!candidates.length) return;

  // Percentile of playlist count among candidates, for seeding familiarity.
  const ranked = [...candidates].sort((a, b) => a[1].n - b[1].n);
  const percentile = new Map();
  ranked.forEach(([key], i) => percentile.set(key, (i / Math.max(1, ranked.length - 1)) * 100));

  const reasons = { accepted: 0, noYear: 0, decadeClash: 0, noCrowdDecade: 0 };
  let sinceCheckpoint = 0;

  async function save() {
    await writeSongs(OUT, {
      meta: {
        batch: 'batch-006',
        count: produced.length,
        note: 'Generated from the playlist index rather than written by hand. year comes from MusicBrainz release-groups and is accepted only where it agrees with the decade the song\'s playlists put it in. familiarity and skew are seeded from canonicity and year respectively - they are starting points, not judgements, and have not been reviewed.',
        source: 'data/canonicity.json + MusicBrainz release-groups',
      },
      songs: produced,
    });
  }

  for (const [i, [key, entry]] of candidates.entries()) {
    const crowd = crowdDecade(entry);
    if (!crowd) { reasons.noCrowdDecade++; continue; }

    const year = await yearOf(entry.artist, entry.title);
    await sleep(PAUSE_MS);

    if (year === null) { reasons.noYear++; continue; }

    // The cross-check. Two unrelated sources must place the song in the same
    // decade, or we do not use it.
    const [lo, hi] = DECADE_YEARS[crowd] ?? [0, 9999];
    if (year < lo || year > hi) { reasons.decadeClash++; continue; }

    produced.push({
      artist: entry.artist,
      title: entry.title,
      year,
      decade: `${Math.floor(year / 10) * 10}s`,
      genres: genresOf(entry),
      familiarity: familiarityFor(percentile.get(key) ?? 50),
      skew: skewFor(year),
      spotify_uri: null,
      market_checked: null,
      canonicity: Math.round(percentile.get(key) ?? 50),
    });
    reasons.accepted++;

    if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
      sinceCheckpoint = 0;
      await save();
      process.stdout.write(`\r  ${i + 1}/${candidates.length} checked, ${reasons.accepted} accepted`);
    }
  }

  await save();
  console.log(`\n\naccepted:            ${reasons.accepted}`);
  console.log(`rejected, no year:   ${reasons.noYear}`);
  console.log(`rejected, decade clash: ${reasons.decadeClash}`);
  console.log(`skipped, no clear era:  ${reasons.noCrowdDecade}`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)} with ${produced.length} songs`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
