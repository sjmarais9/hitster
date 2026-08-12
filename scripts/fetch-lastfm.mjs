#!/usr/bin/env node
//
// Fetches Last.fm listener counts for every song we have:
//
//   node scripts/fetch-lastfm.mjs
//
// Needs LASTFM_API_KEY, either in the environment or in a .env file at the repo
// root. .env is gitignored; no key goes anywhere near a commit.
//
// Why listeners rather than playcount. `listeners` is the number of distinct
// people who have ever scrobbled the track. `playcount` is total plays, so it
// rewards a small number of obsessives - which is the same flaw that made
// Spotify popularity useless to us. Breadth is what familiarity means here.
//
// This is a second, independent opinion alongside the Deezer playlist index.
// Where the two agree, we can be reasonably confident. Where they disagree, one
// of them is measuring fashion rather than canonicity, and that is worth
// knowing before either is trusted.
//
// Output: data/lastfm.json, written incrementally and resumable.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'lastfm.json');

const API = 'https://ws.audioscrobbler.com/2.0/';
const PAUSE_MS = 220;          // Last.fm asks for no more than 5 requests/second
const CHECKPOINT_EVERY = 100;

async function apiKey() {
  if (process.env.LASTFM_API_KEY) return process.env.LASTFM_API_KEY.trim();
  try {
    // Tolerant on purpose. A .env written by PowerShell carries a byte order
    // mark, one written by hand may have spaces or quotes around the value, and
    // none of that should look like a missing key.
    const env = (await readFile(path.join(ROOT, '.env'), 'utf8')).replace(/^﻿/, '');
    for (const raw of env.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith('LASTFM_API_KEY')) continue;
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  } catch {
    // no .env, fall through
  }
  throw new Error(
    'No LASTFM_API_KEY. Put it in the environment, or in a .env file at the repo\n' +
    'root as LASTFM_API_KEY=xxx. Get one at https://www.last.fm/api/account/create',
  );
}

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyFor = (artist, title) => `${artist}|${title}`.toLowerCase();

async function main() {
  const key = await apiKey();

  const sources = [
    'data/songs.json',
    'data/batch-003.seed.json',
    'data/batch-004.seed.json',
    'data/batch-005.seed.json',
  ];
  const songs = [];
  for (const file of sources) songs.push(...((await readJson(file, { songs: [] })).songs ?? []));

  // The pool already contains batch 002, so the sources overlap.
  const seen = new Set();
  const unique = songs.filter((s) => {
    const k = keyFor(s.artist, s.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Resume: anything already fetched is left alone.
  const existing = await readJson('data/lastfm.json', { tracks: {} });
  const tracks = existing.tracks ?? {};
  const todo = unique.filter((s) => !(keyFor(s.artist, s.title) in tracks));

  console.log(`${unique.length} songs, ${Object.keys(tracks).length} already fetched, ${todo.length} to go`);
  if (todo.length === 0) return;

  async function save() {
    const values = Object.values(tracks).map((t) => t.listeners).filter((n) => n > 0).sort((a, b) => a - b);
    await writeFile(OUT, JSON.stringify({
      meta: {
        source: 'Last.fm track.getInfo',
        count: Object.keys(tracks).length,
        with_listeners: values.length,
        median_listeners: values.length ? values[Math.floor(values.length / 2)] : 0,
        generated: new Date().toISOString().slice(0, 10),
        note: 'listeners is the number of distinct people who have scrobbled the track, which measures breadth rather than intensity. Advisory only: it reflects the Last.fm userbase, which skews Western, male and rock-leaning, and will badly under-represent South African music.',
      },
      tracks,
    }, null, 2) + '\n', 'utf8');
  }

  let done = 0;
  let sinceCheckpoint = 0;
  let failures = 0;

  for (const song of todo) {
    const params = new URLSearchParams({
      method: 'track.getInfo',
      api_key: key,
      artist: song.artist,
      track: song.title,
      autocorrect: '1',
      format: 'json',
    });

    try {
      const response = await fetch(`${API}?${params}`);
      const body = await response.json();

      if (body.error) {
        // 6 is "track not found", which is a real answer rather than a failure.
        tracks[keyFor(song.artist, song.title)] = { listeners: 0, playcount: 0, found: false };
      } else {
        const t = body.track ?? {};
        tracks[keyFor(song.artist, song.title)] = {
          listeners: Number(t.listeners ?? 0),
          playcount: Number(t.playcount ?? 0),
          found: true,
          // What Last.fm thinks it matched, so bad matches are visible later.
          matched: t.name && t.artist?.name ? `${t.artist.name} - ${t.name}` : null,
        };
      }
    } catch (err) {
      failures++;
      if (failures > 20) throw new Error(`Too many failures, last: ${err.message}`);
    }

    done++;
    if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
      sinceCheckpoint = 0;
      await save();
      process.stdout.write(`\r  ${done}/${todo.length} fetched`);
    }
    await sleep(PAUSE_MS);
  }

  await save();
  console.log(`\n${done} fetched, ${failures} request failures`);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
