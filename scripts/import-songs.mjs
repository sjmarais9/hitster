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
import { writeSongs } from './lib/songs-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Exit code meaning "the daily quota ran out", not "something went wrong". */
export const EXIT_RATE_LIMITED = 75;

const HELP = `
Resolve a batch of songs to Spotify track URIs.

  node scripts/import-songs.mjs [options]

  --in <file>       batch to import      (default data/songs.seed.json)
  --out <file>      playable pool        (default data/songs.json)
  --review <file>   needs manual work    (default data/review.json)
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

/**
 * The pool and the review file both hold a `songs` array, so both go through
 * the shared serialiser. Writing them with plain indentation reformats every
 * song into twenty lines and makes the next diff unreadable.
 */
async function writeJson(file, data) {
  const target = path.resolve(ROOT, file);
  if (Array.isArray(data.songs)) {
    await writeSongs(target, data);
    return;
  }
  await writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Batches may be a bare array or the { meta, songs } wrapper the seed uses. */
const songsOf = (doc) => (Array.isArray(doc) ? doc : doc.songs ?? []);

/** Identity of a song, independent of whether it has been resolved yet. */
const keyOf = (song) => `${song.artist}|${song.title}|${song.year}`.toLowerCase();

// There is no popularity capture here, deliberately.
//
// Spotify does not return `popularity` to this app: the field is absent from
// search results and from GET /tracks/{id}, and GET /tracks?ids= is 403 outright.
// That is the post-2024 restriction on development-mode apps, not a bug we can
// fix. Cross-checking our familiarity tags against streaming numbers is
// therefore not available, and scripts/check-tags.mjs does what it can without
// the network instead.
//
// If this app is ever granted extended quota mode, the field may come back and
// this is where it would be fetched.

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

  // Our fields belong to the batch file, not the pool. Re-tagging a song has to
  // reach the pool without re-resolving its URI, which would mean another
  // authorisation and another round of API calls for no new information.
  let refreshed = 0;
  for (const song of batch) {
    const existing = resolved.get(keyOf(song));
    if (!existing?.spotify_uri) continue;
    const updated = {
      ...existing,
      decade: song.decade,
      genres: song.genres,
      familiarity: song.familiarity ?? null,
      skew: song.skew ?? null,
      // Measured, not tagged, but it belongs to the batch entry just the same -
      // and it is half of what scoreOf blends. Left out of the record the
      // import built, so 687 songs reached the pool with it silently dropped
      // and fell back to tag-only scoring. Refreshing from the batch here means
      // the next run repairs anything already imported without it.
      canonicity: song.canonicity ?? existing.canonicity ?? null,
      // Present but null on anything imported before album capture existed.
      // Backfilling needs --recheck, which costs a full re-resolve.
      album: existing.album ?? null,
    };
    if (JSON.stringify(updated) !== JSON.stringify(existing)) {
      resolved.set(keyOf(song), updated);
      refreshed++;
    }
  }
  if (refreshed > 0) console.log(`Refreshed our fields on ${refreshed} already-resolved song(s)`);

  // Count what is outstanding before --limit truncates it, or the summary
  // reports everything as already done whenever a limit is in play.
  const outstanding = batch.filter((song) => opts.recheck || !resolved.get(keyOf(song))?.spotify_uri);
  const queue = outstanding.slice(0, opts.limit);

  const alreadyDone = batch.length - outstanding.length;
  const deferred = outstanding.length - queue.length;
  console.log(`${batch.length} songs in ${opts.in}`);
  if (alreadyDone > 0) console.log(`${alreadyDone} already resolved, skipping (use --recheck to redo)`);
  if (deferred > 0) console.log(`${deferred} outstanding but held back by --limit`);
  if (queue.length === 0) console.log('Nothing new to resolve.');
  else console.log(`Resolving ${queue.length}...`);

  // Only ask for authorisation if there is actually something to look up. A
  // re-tag with no new songs should not open a browser.
  const spotify = queue.length > 0 ? await authorise({ port: opts.port }) : null;

  const review = [];
  const yearSuspects = [];
  let matched = 0;
  let aborted = null;

  // A circuit breaker for the difference between "this song cannot be matched"
  // and "nothing can be matched right now".
  let consecutiveFailures = 0;
  const FAILURE_LIMIT = 20;

  // Correcting a song's year changes its identity key, which would otherwise
  // leave the old entry behind as a duplicate pointing at the same track.
  // Dedupe on URI, preferring whichever entry the current batch still refers to.
  const batchKeys = new Set(batch.map(keyOf));
  function buildPool() {
    const byUri = new Map();
    for (const song of resolved.values()) {
      if (!song.spotify_uri) continue;
      if (!byUri.has(song.spotify_uri) || batchKeys.has(keyOf(song))) {
        byUri.set(song.spotify_uri, song);
      }
    }
    return [...byUri.values()];
  }

  async function savePool() {
    if (opts.dryRun) return;
    const pool = buildPool();
    await writeJson(opts.out, {
      meta: {
        count: pool.length,
        market: MARKET,
        generated: new Date().toISOString().slice(0, 10),
        note: 'Playable pool. year is our value and is the original release year, never Spotify\'s.',
      },
      songs: pool,
    });
  }

  // A long run must never be able to lose everything. Five hundred songs is
  // twenty minutes of API calls, and a rate limit, a dropped connection or a
  // stray Ctrl-C at minute nineteen used to discard all of it.
  const CHECKPOINT_EVERY = 25;
  let sinceCheckpoint = 0;

  for (const [index, song] of queue.entries()) {
    const label = `${song.artist} - ${song.title} (${song.year})`;
    process.stdout.write(`[${index + 1}/${queue.length}] ${label} ... `);

    let best;
    try {
      best = pickBest(song, await findCandidates(spotify, song));
    } catch (err) {
      // A quota is not this song's fault, and every remaining song would fail
      // the same way. Stop, keep what was resolved, and say so.
      if (err.rateLimited) {
        console.log('rate limited');
        aborted = err;
        break;
      }
      console.log(`error`);
      review.push({ ...song, problem: `lookup failed: ${err.message}`, candidates: [] });

      // A run of consecutive failures is not a run of unmatchable songs, it is
      // the network being down or the token being dead. Without this, a drop at
      // 3am marks every remaining song "needs manual resolution", returns
      // normally, and the wrapper reports success over a pool that did not grow.
      // One bad song is noise; twenty in a row is a broken environment.
      if (++consecutiveFailures >= FAILURE_LIMIT) {
        aborted = new Error(
          `${consecutiveFailures} lookups failed in a row - last: ${err.message}. `
          + 'That is an environment problem rather than a data problem, so nothing '
          + 'further would succeed either.');
        break;
      }
      continue;
    }
    consecutiveFailures = 0;

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
        // Spotify's, not ours, and the only field in the pool that is. The
        // matcher takes whatever pressing Spotify surfaces, so this is often a
        // reissue, remaster or compilation rather than the original album.
        // Descriptive only - nothing should key off it.
        album: best.track.album?.name ?? null,
        market_checked: MARKET,
        // Ours, measured rather than tagged. scoreOf blends it with the
        // familiarity tag, so a song that arrives without it is scored on the
        // tag alone - which is exactly the single fallible judgement the
        // measurement exists to temper.
        canonicity: song.canonicity ?? null,
      });

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

    // Counted separately from `matched`, so a run of review entries after a
    // checkpoint cannot retrigger it on every iteration.
    if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
      sinceCheckpoint = 0;
      await savePool();
      process.stdout.write(`  ... checkpointed, ${buildPool().length} in the pool\n`);
    }
  }

  const pool = buildPool();

  console.log(`\n${matched} matched, ${review.length} need review, pool is now ${pool.length} songs`);

  if (opts.dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  await savePool();
  console.log(`Wrote ${opts.out}`);

  if (yearSuspects.length > 0) {
    console.log(`\n${yearSuspects.length} song(s) where Spotify dates the track earlier than we do:`);
    for (const s of yearSuspects) {
      console.log(`  ${s.artist} - ${s.title}: ours ${s.our_year}, Spotify ${s.spotify_earliest_year}`);
    }
  }

  if (aborted) {
    console.log(`\nSTOPPED EARLY: ${aborted.message}`);
    console.log(`Everything resolved so far has been saved. Re-run the same command to continue.`);

    // Two different reasons to stop early, and they must not report the same
    // way. A quota is expected and self-clearing: the wrapper records the
    // lockout, waits, and the scheduled task counts the day a success. A dead
    // token or a dead network is neither - it needs somebody to look at it, and
    // reporting it as a quota day is the same laundering the circuit breaker
    // was added to stop, moved one step downstream.
    process.exitCode = aborted.rateLimited ? EXIT_RATE_LIMITED : 1;
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

// Note on resuming: a run that stops early has still written every song it
// resolved, and the next run skips anything already in the pool. Re-running the
// same command picks up where it left off.
