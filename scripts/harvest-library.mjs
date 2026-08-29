#!/usr/bin/env node
//
// Reads the household's own Spotify playlists and records which artists they
// contain:
//
//   node scripts/harvest-library.mjs
//
// Why this exists. Canonicity measures how often the world's playlist curators
// reach for a song, and it is the best signal available for "would anyone know
// this" - but it is a signal about everyone, and the game is played by one
// family in Stellenbosch. It cannot see that this household listens to Pearl
// Jam and Spoegwolf, and it scores Die Heuwels Fantasties the way it scores any
// other band four people have heard of.
//
// A song by an artist already on the family's own playlists needs no global
// evidence. The evidence is that they put it there. So the generator can drop
// its playlist-count threshold to nothing for these artists, which is how
// Fokofpolisiekar and Karen Zoid reach the deck at all: they sit on four and
// eleven playlists worldwide, far under the bar, and every one of the 96 South
// African tracks in the index was being skipped for that reason.
//
// Only artist names are kept. Which songs the household actually has is their
// business and is not what this is for - the point is whose music gets a
// lowered bar, not which tracks to copy.
//
// The token needs no scopes, so this reads public playlists only. A private one
// answers 403 and is reported rather than silently skipped.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authorise } from './lib/cli-auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'library-artists.json');

// Found with the Spotify connector's own search. Add to this by hand: a
// playlist has to be public for a no-scope token to read it.
const PLAYLISTS = [
  { name: '90s alternative', owner: 'sjmarais', id: '0zdd8tLKo7sVuW4n4D5Ead' },
  { name: 'YEF 2025', owner: 'Aletsia', id: '0Pj0QlW51VIfy2xHnOGjT0' },
  { name: 'Temp', owner: 'sjmarais', id: '2HOpz2b0wGKYCV4dyE6ORv' },
];

// Local acts the household would know whether or not they are on a playlist
// today. Kept beside the harvested names because the reason is the same - no
// global measure will ever rank them properly - and because a playlist is a
// snapshot of one month's listening rather than of a taste.
const LOCAL = [
  'Spoegwolf', 'Francois van Coke', 'Karen Zoid', 'Fokofpolisiekar',
  'Die Heuwels Fantasties', 'Jack Parow', 'Kurt Darren', 'Bok van Blerk',
  'The Parlotones', 'Prime Circle', 'Seether', 'Jeremy Loops',
  'Matthew Mole', 'Early B', 'Johnny Clegg', 'Juluka', 'Mango Groove',
  'Freshlyground', 'Springbok Nude Girls', 'Watershed', 'Goldfish',
];

async function main() {
  const spotify = await authorise({ port: 3000 });
  const artists = new Map();
  const sources = [];

  for (const list of PLAYLISTS) {
    let url = `playlists/${list.id}/items?limit=100`;
    let tracks = 0;
    try {
      while (url) {
        const page = await spotify(url);
        for (const entry of page.items ?? []) {
          // The endpoint answers with `item`; older clients expect `track`.
          const track = entry.item ?? entry.track;
          if (track?.type !== 'track' || !track.artists?.length) continue;
          tracks++;
          // Every credited artist, not only the first: a feature is still
          // someone this household chose to listen to.
          for (const a of track.artists) {
            artists.set(a.name, (artists.get(a.name) ?? 0) + 1);
          }
        }
        url = page.next ? page.next.replace('https://api.spotify.com/v1/', '') : null;
      }
      console.log(`${list.name.padEnd(20)} ${String(tracks).padStart(4)} tracks  (${list.owner})`);
      sources.push({ ...list, tracks });
    } catch (err) {
      console.warn(`${list.name.padEnd(20)} could not be read - ${err.message}`);
      console.warn('  A playlist has to be public. The token deliberately holds no scopes.');
    }
  }

  for (const name of LOCAL) if (!artists.has(name)) artists.set(name, 0);

  const names = [...artists.keys()].sort((a, b) => a.localeCompare(b));
  await writeFile(OUT, `${JSON.stringify({
    meta: {
      count: names.length,
      sources,
      local: LOCAL.length,
      generated: new Date().toISOString().slice(0, 10),
      note: 'Artists the household listens to. generate-from-index.mjs --artists drops '
        + 'its playlist-count threshold for these, because being on the family playlist is '
        + 'the evidence a global count cannot supply. Names only, no songs.',
    },
    artists: names,
    // The two lists do different jobs and must not be merged.
    //
    // `artists` lowers the generator's playlist threshold: a band on the family
    // playlist is worth asking MusicBrainz about even if the world has barely
    // playlisted it.
    //
    // `local` additionally exempts from the import's canonicity floor, and that
    // is a stronger claim, so it is the shorter list. Canonicity is a fair
    // measure of whether anyone knows Coldplay's Sparks - it says 20, and it is
    // right. It is not a fair measure of Spoegwolf, who score 7 because the
    // world's playlist curators are not in Stellenbosch. Exempting every
    // household artist let deep album tracks through on the strength of the band
    // being liked, which is not the same as the song being known.
    local: LOCAL,
  }, null, 2)}\n`, 'utf8');

  console.log(`\n${names.length} artists (${names.length - LOCAL.filter((l) => !artists.get(l)).length} from playlists, `
    + `${LOCAL.filter((l) => !artists.get(l)).length} local names added by hand)`);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

await main();
