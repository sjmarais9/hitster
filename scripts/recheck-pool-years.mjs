#!/usr/bin/env node
//
// Runs the two-source year check over songs already in the pool:
//
//   node scripts/recheck-pool-years.mjs [--dry] [--port 3001]
//
// The check in import-songs.mjs only sees a song as it lands. Everything
// imported before 16 August was checked against Spotify alone or, before that,
// against nothing - and 1,543 of the batch-006 songs in the pool were dated by
// the release-group lookup that put Cruel Summer in 2023. They are being dealt
// tonight and nothing will look at them again.
//
// This closes that, and it is cheap for a reason worth writing down. Every song
// in the pool already has a verified spotify_uri, so the release date comes from
// a track lookup rather than a search. That matters twice over: a search costs a
// query against the quota that has been the binding constraint on this project
// since day one, and it can also return the wrong track, which a lookup by id
// cannot.
//
// GET /tracks?ids= would do fifty at a time and sixty requests for the whole
// pool. It returns 403 for this app, tested on 16 August while single lookups on
// the same token were returning 200, so this walks them one at a time instead -
// about twelve minutes at the rate Spotify allows. The batch path is tried first
// anyway, since a 403 that appears for no documented reason may disappear the
// same way.
//
// They do share the quota, and a small test said otherwise. With `search`
// already blocked for the day, fifteen consecutive `tracks/{id}` lookups
// returned 200 and that was read as separate budgets. It is not: a real run
// stopped at 583 songs with the same daily-quota 429 the importer gets. Fifteen
// requests were simply too few to reach the limit.
//
// So this costs the importer roughly one song of backlog per song it checks,
// and the whole pool is about four days of quota. It is worth running only
// while the backlog is not the priority, or a few hundred at a time in the gaps.
// It checkpoints after every 250 and resumes exactly where it stopped.
//
// MusicBrainz is not called at all. Its answers are on disk from the sweep.
//
// Writes a report and nothing else. The classifier is deliberately conservative
// - see lib/year-check.mjs - but `confirmed` still means a year gets rewritten,
// and this project has learned four times what happens when a rule does that
// without a person having read it.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authorise } from './lib/cli-auth.mjs';
import { readSongs } from './lib/songs-file.mjs';
import { classifyYear, bySeverity } from './lib/year-check.mjs';
import { verifiedYearFor } from './lib/reviewed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'pool-year-recheck.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 3000;

const BATCH = 50; // Spotify's maximum for /tracks

const { songs } = await readSongs(path.join(ROOT, 'data', 'songs.json'));
const mbYears = JSON.parse(
  await readFile(path.join(ROOT, 'data', 'musicbrainz-years.json'), 'utf8'),
).years ?? {};

const key = (s) => `${s.artist}|${s.title}`.toLowerCase();
const idOf = (uri) => (uri ?? '').replace('spotify:track:', '');

// A year somebody established by hand is not up for re-derivation. This is the
// same guard as data.test.mjs, applied before the requests rather than after,
// so a confirmed verdict never even appears for a song that was already settled.
const todo = songs.filter((s) => s.spotify_uri && verifiedYearFor(s) === null);
const settled = songs.length - todo.length;

console.log(`${songs.length} songs in the pool, ${todo.length} to re-check`);
if (settled) console.log(`${settled} skipped: year already established by hand`);
console.log(`${Math.ceil(todo.length / BATCH)} requests at ${BATCH} tracks each\n`);

if (dryRun) {
  console.log('Dry run: no Spotify calls made, nothing written.');
  process.exit(0);
}

const spotify = await authorise({ port: PORT });

const yearOfTrack = (track) => {
  const year = Number(String(track?.album?.release_date ?? '').slice(0, 4));
  return year > 1900 && year < 2030 ? year : null;
};

/** artist|title -> Spotify's release year for the exact track we hold. */
const spotifyYears = new Map();

// Resume, because twelve minutes of somebody's quota should be spent once.
const previous = await (async () => {
  try { return JSON.parse(await readFile(OUT, 'utf8')).spotify_years ?? {}; } catch { return {}; }
})();
for (const [k, y] of Object.entries(previous)) spotifyYears.set(k, y);
if (spotifyYears.size) console.log(`${spotifyYears.size} release dates already on disk, resuming\n`);

const pending = todo.filter((s) => !spotifyYears.has(key(s)));
let batchWorks = true;
let stopped = null;

const save = async (findings = null) => writeFile(OUT, `${JSON.stringify({
  checked: todo.length,
  spotify_dated: spotifyYears.size,
  stopped_early: stopped,
  note: 'Nothing here has been applied. `confirmed` is two independent sources agreeing '
      + 'our year is too late; everything else needs a person.',
  spotify_years: Object.fromEntries(spotifyYears),
  ...(findings ? { findings } : {}),
}, null, 2)}\n`, 'utf8');

for (let i = 0; i < pending.length;) {
  try {
    if (batchWorks) {
      const slice = pending.slice(i, i + BATCH);
      const body = await spotify(`tracks?ids=${slice.map((s) => idOf(s.spotify_uri)).join(',')}&market=ZA`);
      (body.tracks ?? []).forEach((track, n) => {
        const year = yearOfTrack(track);
        if (year) spotifyYears.set(key(slice[n]), year);
      });
      i += slice.length;
    } else {
      const song = pending[i];
      const year = yearOfTrack(await spotify(`tracks/${idOf(song.spotify_uri)}?market=ZA`));
      if (year) spotifyYears.set(key(song), year);
      i += 1;
    }
  } catch (error) {
    if (batchWorks && /403/.test(error.message)) {
      console.log('The batch endpoint is refusing this app; falling back to one at a time.\n');
      batchWorks = false;
      continue;
    }
    // Anything else - a quota, a dead network - keeps what has been gathered.
    // The alternative is throwing away eleven minutes of requests to save one.
    stopped = error.message;
    console.log(`\nSTOPPED at ${spotifyYears.size} of ${todo.length}: ${error.message}`);
    console.log('Progress is saved. Re-run the same command to continue.');
    break;
  }

  if (i % 250 === 0 || i === pending.length) {
    await save();
    console.log(`  ... ${i}/${pending.length}`);
  }
}

// --- classify ------------------------------------------------------------------

const findings = [];
for (const song of todo) {
  const k = key(song);
  const mb = mbYears[k];
  const verdict = classifyYear({
    ours: song.year,
    spotify: spotifyYears.get(k) ?? null,
    musicbrainz: mb ? mb[0] : null,
  });
  if (verdict.verdict === 'ok') continue;

  findings.push({
    artist: song.artist,
    title: song.title,
    our_year: song.year,
    suggested_year: verdict.year,
    verdict: verdict.verdict,
    sources: verdict.sources,
    spotify_year: spotifyYears.get(k) ?? null,
    musicbrainz_year: mb ? mb[0] : null,
    musicbrainz_releases: mb ? mb[1] : null,
    album: song.album ?? null,
    decade_would_change: `${Math.floor(verdict.year / 10) * 10}s` !== song.decade,
  });
}

findings.sort(bySeverity);

await save(findings);

// --- report ---------------------------------------------------------------------

const of = (v) => findings.filter((f) => f.verdict === v);
console.log(`\n${todo.length} re-checked, ${spotifyYears.size} dated by Spotify, `
  + `${todo.filter((s) => mbYears[key(s)]).length} by MusicBrainz\n`);
console.log(`  confirmed     ${String(of('confirmed').length).padStart(4)}  both sources agree our year is too late`);
console.log(`  check         ${String(of('check').length).padStart(4)}  one source disputes it, the other is silent`);
console.log(`  contradicted  ${String(of('contradicted').length).padStart(4)}  one disputes it, the other backs us`);

if (of('confirmed').length) {
  console.log('\nCONFIRMED - these are the ones worth acting on:');
  for (const f of of('confirmed')) {
    console.log(`  ${f.our_year} -> ${f.suggested_year}  ${`${f.artist} - ${f.title}`.slice(0, 42).padEnd(44)}`
      + `sp ${f.spotify_year}  mb ${f.musicbrainz_year}  ${f.decade_would_change ? 'DECADE MOVES  ' : ''}`
      + `album: ${(f.album ?? '-').slice(0, 26)}`);
  }
}

console.log(`\nWrote ${path.relative(ROOT, OUT)}. Nothing was changed.`);
