#!/usr/bin/env node
//
// One-off import tooling. Takes a batch of generated songs (artist, title,
// year, genres), resolves each to a Spotify track URI, verifies it is playable
// in our market, and writes the survivors to the playable pool.
//
//   node scripts/import-songs.mjs --in data/songs.seed.json
//
// Two rules this script exists to enforce:
//
//   1. Our `year` is the source of truth and is never touched. Spotify's
//      release dates reflect remasters, reissues and compilations. Overwriting
//      ours with theirs would silently break the core mechanic of the game.
//      Spotify's year is recorded in the review file as information only.
//
//   2. A song without a confidently matched, playable URI does not enter the
//      pool. It goes to the review file instead. A gap is recoverable; a wrong
//      track mid-round is not.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MARKET } from '../src/config.js';
import { authorise } from './lib/cli-auth.mjs';
import { pickBest, releaseYear } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `
Resolve a batch of songs to Spotify track URIs.

  node scripts/import-songs.mjs [options]

  --in <file>       batch to import      (default data/songs.seed.json)
  --out <file>      playable pool        (default data/songs.json)
  --review <file>   needs manual work    (default data/review.json)
  --popularity <f>  advisory scores      (default data/popularity.json)
  --port <number>   loopback port for auth; must be registered as a redirect
                    URI in the Spotify dashboard   (default 3000)
  --limit <number>  only process the first N songs, for a quick trial
  --recheck         re-resolve songs that already have a URI
  --dry-run         resolve and report, write nothing
  --help
`;

function parseArgs(argv) {
  const opts = {
    in: 'data/songs.seed.json',
    out: 'data/songs.json',
    review: 'data/review.json',
    popularity: 'data/popularity.json',
    port: 3000,
    limit: Infinity,
    recheck: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { console.log(HELP); process.exit(0); }
    else if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--review') opts.review = argv[++i];
    else if (arg === '--popularity') opts.popularity = argv[++i];
    else if (arg === '--port') opts.port = Number(argv[++i]);
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--recheck') opts.recheck = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else { console.error(`Unknown option: ${arg}\n${HELP}`); process.exit(1); }
  }
  return opts;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

async function writeJson(file, data) {
  await writeFile(path.resolve(ROOT, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Batches may be a bare array or the { meta, songs } wrapper the seed uses. */
const songsOf = (doc) => (Array.isArray(doc) ? doc : doc.songs ?? []);

/** Identity of a song, independent of whether it has been resolved yet. */
const keyOf = (song) => `${song.artist}|${song.title}|${song.year}`.toLowerCase();

/** Search, preferring field-filtered query, falling back to a loose one. */
async function findCandidates(spotify, song) {
  const clean = (s) => s.replace(/"/g, ' ').trim();
  const queries = [
    `track:"${clean(song.title)}" artist:"${clean(song.artist)}"`,
    `${clean(song.artist)} ${clean(song.title)}`,
  ];

  for (const q of queries) {
    const params = new URLSearchParams({ q, type: 'track', market: MARKET, limit: '10' });
    const result = await spotify(`search?${params}`);
    const items = result.tracks?.items ?? [];
    if (items.length > 0) return items;
  }
  return [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const batch = songsOf(await readJson(opts.in));
  if (batch.length === 0) throw new Error(`No songs found in ${opts.in}`);

  const existingPool = songsOf(await readJson(opts.out, { songs: [] }));
  const resolved = new Map(existingPool.map((s) => [keyOf(s), s]));

  const queue = batch
    .filter((song) => opts.recheck || !resolved.get(keyOf(song))?.spotify_uri)
    .slice(0, opts.limit);

  const alreadyDone = batch.length - queue.length;
  console.log(`${batch.length} songs in ${opts.in}`);
  if (alreadyDone > 0) console.log(`${alreadyDone} already resolved, skipping (use --recheck to redo)`);
  if (queue.length === 0) { console.log('Nothing to do.'); return; }
  console.log(`Resolving ${queue.length}...`);

  const spotify = await authorise({ port: opts.port });

  const review = [];
  const yearSuspects = [];
  // Merged rather than replaced, so a partial run does not lose earlier scores.
  const priorPopularity = await readJson(opts.popularity, { scores: {} });
  const popularity = new Map(Object.entries(priorPopularity.scores ?? {}));
  let matched = 0;

  for (const [index, song] of queue.entries()) {
    const label = `${song.artist} - ${song.title} (${song.year})`;
    process.stdout.write(`[${index + 1}/${queue.length}] ${label} ... `);

    let best;
    try {
      best = pickBest(song, await findCandidates(spotify, song));
    } catch (err) {
      console.log(`error`);
      review.push({ ...song, problem: `lookup failed: ${err.message}`, candidates: [] });
      continue;
    }

    if (best?.verdict === 'confident') {
      matched++;
      console.log(`ok`);
      resolved.set(keyOf(song), {
        // Our fields, verbatim. year, familiarity and skew in particular are
        // ours and are never taken from Spotify.
        artist: song.artist,
        title: song.title,
        year: song.year,
        decade: song.decade,
        genres: song.genres,
        familiarity: song.familiarity ?? null,
        skew: song.skew ?? null,
        spotify_uri: best.track.uri,
        market_checked: MARKET,
      });

      // Advisory only, and kept out of the pool so it can never be mistaken for
      // one of our values. Used by check-familiarity.mjs to flag disagreements.
      popularity.set(best.track.uri, best.track.popularity ?? null);

      // Our years are written from memory and will occasionally be wrong.
      // Spotify's date is later than ours all the time - that is just a
      // remaster or reissue - but *earlier* than ours should not happen for an
      // original release, so it is worth a human look.
      const spotifyYear = releaseYear(best.track);
      if (spotifyYear && spotifyYear < song.year - 1) {
        yearSuspects.push({
          artist: song.artist,
          title: song.title,
          our_year: song.year,
          spotify_earliest_year: spotifyYear,
          note: 'Spotify dates this earlier than we do. Our year may be wrong.',
        });
      }
    } else {
      console.log(best ? `review (${best.reason})` : 'review (no results)');
      review.push({
        artist: song.artist,
        title: song.title,
        year: song.year,
        problem: best ? best.reason : 'no search results',
        candidates: (best ? [best] : []).map((g) => ({
          uri: g.track.uri,
          title: g.track.name,
          artists: g.track.artists.map((a) => a.name),
          album: g.track.album?.name,
          spotify_release_year: releaseYear(g.track),   // information only
          verdict: g.verdict,
        })),
      });
    }
  }

  const pool = [...resolved.values()].filter((s) => s.spotify_uri);

  console.log(`\n${matched} matched, ${review.length} need review, pool is now ${pool.length} songs`);

  if (opts.dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  await writeJson(opts.out, {
    meta: {
      count: pool.length,
      market: MARKET,
      generated: new Date().toISOString().slice(0, 10),
      note: 'Playable pool. year is our value and is the original release year, never Spotify\'s.',
    },
    songs: pool,
  });
  console.log(`Wrote ${opts.out}`);

  await writeJson(opts.popularity, {
    meta: {
      count: popularity.size,
      note: 'Spotify popularity, 0-100. ADVISORY ONLY. It measures current streaming, not how well this crowd knows a song, and it drifts over time. Never copy it into the pool and never let it set familiarity. Used by check-familiarity.mjs to flag disagreements worth a human look.',
    },
    scores: Object.fromEntries(popularity),
  });
  console.log(`Wrote ${opts.popularity}`);

  if (yearSuspects.length > 0) {
    console.log(`\n${yearSuspects.length} song(s) where Spotify dates the track earlier than we do:`);
    for (const s of yearSuspects) {
      console.log(`  ${s.artist} - ${s.title}: ours ${s.our_year}, Spotify ${s.spotify_earliest_year}`);
    }
  }

  if (review.length > 0 || yearSuspects.length > 0) {
    await writeJson(opts.review, {
      meta: {
        count: review.length,
        note: 'Needs manual resolution. Add a verified spotify_uri and move the entry into the pool. spotify_release_year is shown for context only and must never become our year.',
      },
      songs: review,
      year_suspects: yearSuspects,
    });
    console.log(`Wrote ${opts.review} - ${review.length} unmatched, ${yearSuspects.length} year(s) to check`);
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
