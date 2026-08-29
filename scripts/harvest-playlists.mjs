#!/usr/bin/env node
//
// Builds a canonicity index by counting how often tracks appear across public
// playlists:
//
//   node scripts/harvest-playlists.mjs
//
// Why playlists rather than play counts. A play count measures consumption,
// which is dominated by algorithmic push and passive listening. A playlist
// appearance measures a decision: somebody building a themed list thought this
// song belonged on it. That is much closer to "is this song canonical", which
// is what our `familiarity` tag is trying to express.
//
// Deezer is used because its API needs no key, no auth and no approval, unlike
// Spotify's, which has already cost us a stripped `popularity` field, a 403 on
// /tracks?ids= and a daily quota that gates the import backlog.
//
// Themes carry a decade and a genre so the index can answer conditional
// questions - "how canonical is this within 1970s soul" - rather than only
// global ones. A deep cut that appears on most soul playlists is canonical in a
// way a global count would hide.
//
// Output: data/canonicity.json, written incrementally so a run that dies keeps
// everything it has gathered.

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalise } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'canonicity.json');

const API = 'https://api.deezer.com';
const PLAYLISTS_PER_THEME = 25;
const MAX_TRACKS_PER_PLAYLIST = 200;
const PAUSE_MS = 220;            // Deezer tolerates ~50 requests per 5 seconds
const CHECKPOINT_EVERY = 25;     // playlists

const DECADES = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const GENRES = [
  'rock', 'pop', 'hip hop', 'soul', 'funk', 'metal', 'indie',
  'dance', 'country', 'reggae', 'r&b', 'punk',
];

// Themes with no decade or genre, to catch songs that are canonical in general
// rather than within a niche.
const GENERAL = [
  'greatest hits of all time', 'party classics', 'karaoke classics',
  'wedding party', 'road trip', 'feel good classics', 'anthems',
  'one hit wonders', 'guitar classics', 'summer classics',
];

// Themes that are about fame itself rather than about a genre.
//
// The grid below is 91 decade-by-genre themes against ten general ones, and a
// playlist called "1970s funk" is built by someone with something to prove. It
// reaches for the track you might not know, which is the right instinct for a
// genre list and the wrong one for measuring whether a table would shout at a
// song. The index inherited that bias wholesale and canonicity is a percentile
// over it, so the measure was quietly asking "how deep is this within its
// niche" when the game wants "would anyone here place it".
//
// These correct the balance. The songs they surface are the ones that appear on
// lists whose entire premise is that everybody already knows them.
const FAMOUS = [
  'number one hits', 'chart toppers', 'biggest songs ever',
  'classic hits radio', 'golden oldies', 'throwback hits',
  'dance floor fillers', 'wedding reception', 'school disco',
  'most played songs', 'iconic songs', 'songs everyone knows',
  'sing in the car', 'crowd pleasers', 'floor fillers',
  'best of the 80s', 'best of the 90s', 'best of the 2000s',
  'radio favourites', 'timeless classics',
];

// South African and African themes, because global playlists systematically
// under-represent the local canon. This is the same blind spot rule 1 in
// docs/tagging.md exists to correct for.
const LOCAL = [
  'south african classics', 'kwaito classics', 'amapiano hits', 'afrobeats',
  'sa hip hop', 'south african rock', 'african classics', 'afro house',
];

// Added after the first harvest. Validation showed Last Christmas and
// Ghostbusters scoring near zero despite being tagged `standard` - not a
// tagging error, but songs that live on seasonal and soundtrack playlists which
// decade-by-genre themes never touch.
const OCCASION = [
  'christmas classics', 'christmas party', 'movie soundtracks', 'film classics',
  'novelty songs', 'sing along', 'workout classics', 'running songs',
  'kids party', 'disney classics', 'musicals', 'tv themes',
  'love songs', 'breakup songs', 'sad songs', 'protest songs',
  'stadium anthems', 'festival anthems', 'pub jukebox', 'braai playlist',
];

function buildThemes() {
  const themes = [];
  for (const decade of DECADES) {
    themes.push({ q: `${decade.replace('s', '')}s hits`, decade, genre: null });
    for (const genre of GENRES) {
      themes.push({ q: `${decade.replace('s', '')}s ${genre}`, decade, genre });
    }
  }
  for (const q of GENERAL) themes.push({ q, decade: null, genre: null });
  for (const q of FAMOUS) themes.push({ q, decade: null, genre: null });
  for (const q of LOCAL) themes.push({ q, decade: null, genre: 'african' });
  for (const q of OCCASION) themes.push({ q, decade: null, genre: null });
  return themes;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deezer(pathAndQuery, attempt = 0) {
  const response = await fetch(`${API}/${pathAndQuery}`);

  if (!response.ok) {
    if (response.status === 429 && attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return deezer(pathAndQuery, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText} for ${pathAndQuery}`);
  }

  const body = await response.json();
  // Deezer signals quota problems in the body rather than the status code.
  if (body.error) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return deezer(pathAndQuery, attempt + 1);
    }
    throw new Error(`${body.error.type ?? 'error'}: ${body.error.message ?? ''}`);
  }
  return body;
}

/** artist|title, normalised so remaster and feat. suffixes collapse together. */
const keyFor = (artist, title) => `${normalise(artist)}|${normalise(title)}`;

async function main() {
  const themes = buildThemes();
  console.log(`${themes.length} themes, up to ${PLAYLISTS_PER_THEME} playlists each\n`);

  // Resume from whatever a previous run gathered. Without this, adding themes
  // would discard the existing index rather than extend it - forty minutes of
  // work thrown away to add twenty themes.
  let existing = { tracks: {}, meta: {} };
  try {
    existing = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    // first run
  }

  // key -> { n, decades: {}, genres: {}, artist, title }
  const index = new Map(Object.entries(existing.tracks ?? {}));
  const seenPlaylists = new Set(existing.meta?.playlist_ids ?? []);
  let playlistCount = existing.meta?.playlists ?? 0;
  let trackCount = existing.meta?.track_appearances ?? 0;
  let sinceCheckpoint = 0;

  if (index.size > 0) {
    console.log(`resuming: ${index.size} tracks, ${seenPlaylists.size} playlists already harvested\n`);
  }

  async function save() {
    const tracks = {};
    for (const [key, entry] of index) {
      // Songs seen once are noise and would triple the file for nothing.
      if (entry.n < 2) continue;
      tracks[key] = entry;
    }
    await writeFile(OUT, JSON.stringify({
      meta: {
        source: 'Deezer public playlists',
        playlists: playlistCount,
        // Kept so a later run can add themes without re-fetching, and without
        // double-counting a playlist that two themes both surface.
        playlist_ids: [...seenPlaylists],
        themes: themes.length,
        track_appearances: trackCount,
        distinct_tracks_kept: Object.keys(tracks).length,
        generated: new Date().toISOString().slice(0, 10),
        note: 'n is the number of distinct playlists a track appeared on. Counts under 2 are dropped. This measures curation, not plays. It is advisory: it says nothing about what one South African family knows, and it under-represents local music despite the African themes.',
      },
      tracks,
    }, null, 2) + '\n', 'utf8');
  }

  for (const [i, theme] of themes.entries()) {
    let playlists;
    try {
      const found = await deezer(`search/playlist?q=${encodeURIComponent(theme.q)}&limit=${PLAYLISTS_PER_THEME}`);
      playlists = found.data ?? [];
    } catch (err) {
      console.log(`[${i + 1}/${themes.length}] ${theme.q} - search failed: ${err.message}`);
      continue;
    }
    await sleep(PAUSE_MS);

    let added = 0;
    for (const playlist of playlists) {
      if (seenPlaylists.has(playlist.id)) continue;
      seenPlaylists.add(playlist.id);

      let tracks;
      try {
        const result = await deezer(`playlist/${playlist.id}/tracks?limit=${MAX_TRACKS_PER_PLAYLIST}`);
        tracks = result.data ?? [];
      } catch {
        continue;
      }
      await sleep(PAUSE_MS);

      playlistCount++;
      added += tracks.length;

      // A track counts once per playlist, however many times it appears in it.
      const inThisPlaylist = new Set();
      for (const track of tracks) {
        if (!track?.title || !track?.artist?.name) continue;
        const key = keyFor(track.artist.name, track.title);
        if (inThisPlaylist.has(key)) continue;
        inThisPlaylist.add(key);
        trackCount++;

        const entry = index.get(key) ?? {
          artist: track.artist.name, title: track.title, n: 0, decades: {}, genres: {},
        };
        entry.n++;
        if (theme.decade) entry.decades[theme.decade] = (entry.decades[theme.decade] ?? 0) + 1;
        if (theme.genre) entry.genres[theme.genre] = (entry.genres[theme.genre] ?? 0) + 1;
        index.set(key, entry);
      }

      if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
        sinceCheckpoint = 0;
        await save();
      }
    }

    console.log(`[${i + 1}/${themes.length}] ${theme.q.padEnd(24)} ${playlists.length} playlists, ${added} tracks, index ${index.size}`);
  }

  await save();
  console.log(`\n${playlistCount} playlists, ${trackCount} appearances, ${index.size} distinct tracks`);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
