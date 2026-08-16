#!/usr/bin/env node
//
// Turns the batch-006 year sweep into the reference the import consults:
//
//   node scripts/build-musicbrainz-reference.mjs
//
// The sweep cost about six hours of MusicBrainz's time at one request a second
// and covered 9,440 songs. Asking again at import would spend that same six
// hours in one-song pieces, spread over the fortnight the backlog takes, and
// get the same answers - MusicBrainz does not revise a 1978 release date.
//
// So the answers are kept. The import reads them, and every song that lands
// arrives with a second opinion already attached and no request made.
//
// Only the year and the release count travel. The rest of the sweep - the gap
// arithmetic, our year at the time - is a snapshot of a moment and would go
// stale the first time a year is corrected, which is the entire point of the
// exercise. Recomputing against the pool as it stands is always right.
//
// Not deployed. .github/workflows/deploy.yml copies data/songs.json alone.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'data', 'batch006-year-sweep-2026-08-16.json');
const OUT = path.join(ROOT, 'data', 'musicbrainz-years.json');

const sweep = JSON.parse(await readFile(IN, 'utf8')).results ?? [];

const years = {};
let skipped = 0;
for (const r of sweep) {
  if (r.mb_year === null || r.mb_year === undefined) { skipped++; continue; }
  // Same key the pool and lib/reviewed.mjs use, so a lookup needs no adapter.
  years[`${r.artist}|${r.title}`.toLowerCase()] = [r.mb_year, r.mb_releases ?? 0];
}

const doc = {
  meta: {
    source: 'MusicBrainz recordings, ranked by how many releases carry each',
    swept: '2026-08-16',
    songs: Object.keys(years).length,
    undated: skipped,
    note: 'A second opinion on `year`, never an answer on its own. It disagreed with '
        + 'batch 006 on 21% of songs and was itself wrong in most of those. See '
        + 'scripts/lib/year-check.mjs for what is done with it and why.',
  },
  // [year, releases]. The release count is kept because a thin entry is worth
  // less than a well-carried one, and a reader deserves to see which they have.
  years,
};

await writeFile(OUT, `${JSON.stringify(doc, null, 0)}\n`, 'utf8');

const bytes = (await readFile(OUT)).length;
console.log(`${Object.keys(years).length} dated songs, ${skipped} MusicBrainz could not date`);
console.log(`Wrote ${path.relative(ROOT, OUT)}, ${(bytes / 1024).toFixed(0)}KB`);
