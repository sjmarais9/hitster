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

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';
import { writeSongs, readSongs } from './lib/songs-file.mjs';
import {
  crowdDecade, genresOf, agreesWithEra, familiarityFor, skewFor, decadeOf, cleanTitle,
  reconcileYear,
} from './lib/seeds.mjs';
import { isExcluded } from './lib/excluded.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'batch-006.seed.json');

// Candidates that have already been tried and failed, and why.
//
// Without this, every pass re-asks MusicBrainz about everything that failed
// before. The rock top-up spent forty-five minutes re-confirming roughly 2,350
// known failures because accepted songs were remembered and rejected ones were
// not.
//
// The reason matters, because not all rejections are permanent:
//
//   noEra        the index has no clear era for it. Permanent until the
//                playlist harvest is extended.
//   decadeClash  the year disagreed with the decade the playlists imply. No
//                longer permanent: since a year two catalogues agree on is
//                accepted without consulting the playlists at all, every one of
//                these was decided under a rule that no longer exists. Retry.
//   noYear       nobody could date it. Worth retrying when a NEW year source
//                exists, which is exactly why the Deezer fallback was added.
//
// So a plain re-run skips everything cached, and `--retry noYear` reopens the
// only category a new source can help with.
const REJECTS = path.join(ROOT, 'data', 'generation-rejects.json');

const UA = 'HitsterPool/1.0 (sjmarais@inrangegolf.com)';
const PAUSE_MS = 1100;            // MusicBrainz asks for one request per second
const CHECKPOINT_EVERY = 25;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const LIMIT = flag('limit', Infinity);
const MIN_PLAYLISTS_DEFAULT = 5;

// Restricts a run to artists the household actually listens to, and drops the
// playlist threshold to nothing for them.
//
// MIN_PLAYLISTS is a proxy for "has anyone heard of this", measured across
// everybody's playlists. It is the only evidence available for a stranger's
// band and it is the wrong evidence for this one: being on the family's own
// playlist is a stronger claim than being on five of anyone else's, and it is a
// claim no global count can make. Fokofpolisiekar appears on four playlists
// worldwide and Francois van Coke on four; both are under the bar, and all 96
// South African tracks in the index were skipped for that reason alone.
//
// Still cross-checked for its year like anything else. The bar this lowers is
// relevance, not correctness.
const ARTISTS = (() => {
  const i = args.indexOf('--artists');
  return i === -1 ? null : args[i + 1];
})();

const MIN_PLAYLISTS = flag('min-playlists', ARTISTS ? 1 : MIN_PLAYLISTS_DEFAULT);

// Restricts the run to one genre family, for topping up a deliberate lean.
// The main pass produces a broad spread; a second pass with --genre rock and a
// lower --min-playlists adds rock without displacing anything already accepted,
// which is how the pool gets weighted toward a taste rather than flattened to
// whatever the playlists happen to contain.
const GENRE = (() => {
  const i = args.indexOf('--genre');
  return i === -1 ? null : args[i + 1];
})();

const GENRE_FAMILIES = {
  rock: ['rock', 'punk', 'metal', 'indie'],
  pop: ['pop', 'dance'],
  urban: ['hip hop', 'r&b', 'soul', 'funk'],
  roots: ['country', 'reggae', 'african'],
};

/** The genre a song leans toward, from the themes it appeared on. */
function leansToward(entry, family) {
  const wanted = GENRE_FAMILIES[family];
  if (!wanted) return true;
  const counts = Object.entries(entry.genres ?? {});
  if (!counts.length) return false;
  const top = counts.sort((a, b) => b[1] - a[1])[0][0];
  return wanted.includes(top);
}

// Titles that are not the song we want, however well they match.
const JUNK = /\bkaraoke\b|\bmade popular by\b|\btribute\b|\bin the style of\b|\blive\b(?!\s*(and|to|at last))|\bremix\b|\bedit\b|\bmix\)|\bcover\b|\binstrumental\b|\bbacking track\b|\bremaster(ed)?\b/i;



// A rejection recorded against a decorated title answered a different question
// from the one we now ask, so it is not evidence about this candidate.
//
// It is the year checks that were misled. MusicBrainz dates the pressing it is
// given: ask it about "YMCA (Original Version 1978)" or "Funkytown (Single
// Version)" and the release-group that comes back is the reissue, which then
// disagrees with the decade the playlists put the song in and is filed as a
// permanent decadeClash. 255 songs were turned away that way, and they are the
// most party-shaped material in the index - Get Down On It, Boogie Nights,
// Ladies Night, Eternal Flame.
//
// Only the reasons that involve asking someone about a title. noEra comes from
// the playlist index alone, which the title never touched, so it stands.
const TITLE_SENSITIVE = new Set(['decadeClash', 'noYear']);

const staleReject = (r) => TITLE_SENSITIVE.has(r.reason) && cleanTitle(r.title) !== r.title;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f) => JSON.parse(await readFile(path.resolve(ROOT, f), 'utf8'));

// Restricts a run to recent candidates, for recovering songs MusicBrainz could
// not date. `--era recent` skips anything the playlists place before 2000.
const ERA = (() => {
  const i = args.indexOf('--era');
  return i === -1 ? null : args[i + 1];
})();

const RECENT = new Set(['2000s', '2010s', '2020s']);

// Reasons to try again despite a cached rejection, e.g. `--retry noYear`.
const RETRY = (() => {
  const i = args.indexOf('--retry');
  return new Set(i === -1 ? [] : args[i + 1].split(','));
})();

/**
 * Apple's release date. The best fallback we have, and the only source that
 * works across every decade.
 *
 * Measured against the same 60 songs used for the others: 88% exact and 94%
 * within a year, against MusicBrainz's 84% and 92%. It matched 50 of 60 where
 * MusicBrainz matched 37 of 40, so its coverage is slightly thinner on songs we
 * already hold - but the point of a fallback is the songs we do not.
 *
 * Per decade it never collapses: 8/8 in the 1980s, 8/9 in the 1970s, 6/9 in the
 * 1960s. Deezer scores 0/9 in the 1960s.
 *
 * One failure mode the cross-check cannot catch: Johnny B. Goode came back as
 * 1955 against a true 1958. Wrong, but inside the same decade, so nothing
 * downstream will notice. Small errors within a decade are this pipeline's
 * blind spot, and are accepted as much less harmful than the twenty-year misses
 * the cross-check exists to stop.
 */
async function itunesYear(artist, title) {
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10`);
    if (!r.ok) return null;
    const body = await r.json();

    const wantA = normalise(artist);
    const wantT = normalise(title);
    const years = (body.results ?? [])
      .filter((x) => normalise(x.trackName ?? '') === wantT && normalise(x.artistName ?? '') === wantA)
      .map((x) => Number(String(x.releaseDate ?? '').slice(0, 4)))
      .filter((y) => y > 1900 && y < 2030);

    return years.length ? Math.min(...years) : null;
  } catch {
    return null;
  }
}

/**
 * Deezer's release date, used only as a fallback and only for recent songs.
 *
 * Measured against 60 songs with known years, Deezer is unusable before 1990
 * and good after 2000:
 *
 *   1960s 0/9    2000s 6/8
 *   1970s 3/9    2010s 7/8
 *   1980s 2/8    2020s 8/8
 *   1990s 1/8
 *
 * The failures are not errors, they are remaster pressings - Johnny B. Goode
 * comes back as 2017 - which is exactly what the project spec warned about on
 * day one. So it is called only where it has been shown to work, and its answer
 * still has to pass the same decade cross-check as MusicBrainz's.
 */
async function deezerYear(artist, title) {
  const q = `track:"${title.replace(/"/g, '')}" artist:"${artist.replace(/"/g, '')}"`;
  try {
    const found = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`)).json();
    if (found.error || !found.data?.length) return null;

    const wantA = normalise(artist);
    const wantT = normalise(title);
    const match = found.data.find((t) =>
      normalise(t.title ?? '') === wantT && normalise(t.artist?.name ?? '') === wantA);
    if (!match) return null;

    await sleep(220);
    const full = await (await fetch(`https://api.deezer.com/track/${match.id}`)).json();
    const year = Number(String(full?.release_date ?? full?.album?.release_date ?? '').slice(0, 4));
    return Number.isFinite(year) && year > 1900 && year < 2030 ? year : null;
  } catch {
    return null;
  }
}

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

async function main() {
  const index = (await readJson('data/canonicity.json')).tracks ?? {};

  const allowed = ARTISTS
    ? new Set((await readJson(ARTISTS)).artists.map((a) => normalise(a)))
    : null;
  if (allowed) {
    console.log(`restricted to ${allowed.size} household artists, `
      + `playlist threshold ${MIN_PLAYLISTS} rather than ${MIN_PLAYLISTS_DEFAULT}`);
  }

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

  // And whatever previous runs already ruled out.
  let rejects = {};
  try {
    rejects = JSON.parse(await readFile(REJECTS, 'utf8')).rejected ?? {};
  } catch {
    // No cache yet; this run builds one.
  }
  // Counted the same way the filter below decides, or the line reports a number
  // of skips that does not happen: a rejection recorded against a decorated
  // title is reopened there, and saying otherwise sends whoever reads this
  // looking for candidates that were in fact retried.
  const reopened = Object.values(rejects).filter(staleReject).length;
  const cachedSkips = Object.values(rejects)
    .filter((r) => !RETRY.has(r.reason) && !staleReject(r)).length;
  if (cachedSkips) {
    console.log(`${cachedSkips} candidates already ruled out, skipping`
      + (RETRY.size ? ` (retrying: ${[...RETRY].join(', ')})` : ''));
  }
  if (reopened) {
    console.log(`${reopened} reopened: rejected on a decorated title, which is not the title we now ask about`);
  }

  const candidates = Object.entries(index)
    .filter(([key, e]) => e.n >= MIN_PLAYLISTS && !JUNK.test(cleanTitle(e.title))
      && (!allowed || allowed.has(normalise(e.artist)))
      // Both spellings have to be unheld: the index key carries the decorated
      // title, and what we would actually write is the clean one.
      && !known.has(key) && !known.has(`${normalise(e.artist)}|${normalise(cleanTitle(e.title))}`)
      && !isExcluded({ artist: e.artist, title: cleanTitle(e.title) })
      && leansToward(e, GENRE)
      // A recovery pass only wants the songs Deezer can actually date. Without
      // this it would re-ask MusicBrainz about 9,516 candidates to reach the
      // 3,133 worth asking Deezer about.
      && (ERA !== 'recent' || RECENT.has(crowdDecade(e)))
      // Already tried and failed, for a reason nothing has changed about.
      && !(rejects[key] && !RETRY.has(rejects[key].reason) && !staleReject(rejects[key])))
    .sort((a, b) => b[1].n - a[1].n)          // most canonical first
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log(`${candidates.length} candidates (on ${MIN_PLAYLISTS}+ playlists, not junk, not already held)`);
  console.log(`${produced.length} already generated\n`);
  if (!candidates.length) return;

  // Percentile of playlist count among candidates, for seeding familiarity.
  const ranked = [...candidates].sort((a, b) => a[1].n - b[1].n);
  const percentile = new Map();
  ranked.forEach(([key], i) => percentile.set(key, (i / Math.max(1, ranked.length - 1)) * 100));

  const reasons = { accepted: 0, noYear: 0, decadeClash: 0, noCrowdDecade: 0, viaItunes: 0, viaDeezer: 0, corroborated: 0 };
  let sinceCheckpoint = 0;

  /** Remember a failure so no later pass pays for it twice. */
  function reject(key, entry, reason) {
    rejects[key] = { artist: entry.artist, title: entry.title, reason };
    reasons[reason === 'noEra' ? 'noCrowdDecade' : reason]++;
  }

  async function save() {
    await writeSongs(OUT, {
      meta: {
        batch: 'batch-006',
        count: produced.length,
        note: 'Generated from the playlist index rather than written by hand. year comes from MusicBrainz release-groups, falling back to Deezer for post-2000 songs it cannot date, and is accepted only where it agrees with the decade the song\'s playlists put it in. familiarity and skew are seeded from canonicity and year respectively - they are starting points, not judgements, and have not been reviewed.',
        source: 'data/canonicity.json + MusicBrainz release-groups + Deezer',
      },
      songs: produced,
    });

    await writeFile(REJECTS, JSON.stringify({
      meta: {
        count: Object.keys(rejects).length,
        note: 'Candidates already tried and failed. noEra is permanent until the playlist harvest is extended. decadeClash and noYear are both worth retrying when a year source changes - and the rule changed on 29 August 2026, when a year seconded by a second catalogue stopped needing to agree with the playlists as well. --retry decadeClash,noYear.',
      },
      rejected: rejects,
    }, null, 2) + '\n', 'utf8');
  }

  for (const [i, [key, entry]] of candidates.entries()) {
    const crowd = crowdDecade(entry);
    if (!crowd) { reject(key, entry, 'noEra'); continue; }

    // Every lookup below asks about the song, not the pressing. MusicBrainz has
    // no release-group for "Karma Chameleon (Remastered 2002)", and asking for
    // one spends a second of the rate limit to learn nothing.
    const title = cleanTitle(entry.title);

    const musicbrainz = await yearOf(entry.artist, title);
    await sleep(PAUSE_MS);

    // iTunes is now asked for every candidate rather than only when MusicBrainz
    // draws a blank, because its answer is worth more as a second opinion than
    // as a fallback. It is accurate across every decade, it is an unrelated
    // catalogue, and two of those landing on the same year is the strongest
    // evidence available here - stronger by a distance than the playlist era.
    //
    // The cost is one extra request per candidate. Cheap against what it buys:
    // 3,558 candidates had been refused for disagreeing with their playlists,
    // 496 of them on twenty or more playlists.
    const itunes = await itunesYear(entry.artist, title);
    await sleep(350);

    // Deezer stays last and stays restricted to recent songs. Before 1990 it
    // returns remaster dates - Johnny B. Goode as 2017 - so it is a fallback
    // for songs the other two could not date, never a corroborating voice.
    const deezer = (musicbrainz === null && itunes === null && RECENT.has(crowd))
      ? await deezerYear(entry.artist, title)
      : null;
    if (deezer !== null) await sleep(220);

    const settled = reconcileYear({ musicbrainz, itunes, deezer });
    if (settled === null) { reject(key, entry, 'noYear'); continue; }
    const { year, corroborated } = settled;

    if (musicbrainz === null && itunes !== null) reasons.viaItunes++;
    if (musicbrainz === null && itunes === null && deezer !== null) reasons.viaDeezer++;
    if (corroborated) reasons.corroborated++;

    // The era check, for a year no second source could stand behind. It is a
    // weak witness - a song that spans decades collects playlists from all of
    // them - so it decides only where nothing better is available, which is the
    // change. It used to decide always, and threw away years that were right.
    if (!corroborated && !agreesWithEra(year, crowd)) {
      reject(key, entry, 'decadeClash');
      continue;
    }

    // Remembered clean, so a second decorated pressing of the same song in the
    // index cannot come back as a second card.
    known.add(`${normalise(entry.artist)}|${normalise(title)}`);

    produced.push({
      artist: entry.artist,
      title,
      year,
      decade: decadeOf(year),
      genres: genresOf(entry),
      familiarity: familiarityFor(percentile.get(key) ?? 50, genresOf(entry)),
      skew: skewFor(year, percentile.get(key) ?? 50),
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
  const rescued = reasons.viaItunes + reasons.viaDeezer;
  if (rescued) {
    console.log(`\nrescued from MusicBrainz's gaps: ${rescued}`);
    console.log(`  by iTunes: ${reasons.viaItunes}   by Deezer: ${reasons.viaDeezer}`);
  }
  console.log(`\nWrote ${path.relative(ROOT, OUT)} with ${produced.length} songs`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});

