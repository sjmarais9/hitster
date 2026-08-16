// Dating a song from MusicBrainz, two ways, kept apart because they are not
// equally trustworthy and one of them cannot be used as evidence at all.
//
// RELEASE-GROUP is what generate-from-index.mjs uses to date batch 006. Its
// weakness is now measured: it prefers a standalone single over the album that
// first carried the song, because the album is titled something else and the
// exact-title filter throws it away. The Ramones' original is filed under
// "She's the One / I Wanna Be Sedated" and loses to a 1988 reissue single that
// matches the title exactly. Six of the nine suspects the 16 August import
// raised failed this way, all in the same direction: our year was the single or
// re-release, never the original.
//
// It follows that re-running this lookup CANNOT check a batch-006 year. It is
// the query that produced the value; asking it again returns the value and
// looks like agreement. The first pass of check-year-suspects did exactly that
// and called eight of nine correct. Use it to see what misled the generator,
// never to confirm.
//
// RECORDING is independent of that, and is ranked by how many releases carry
// each recording rather than by date. A song's original accumulates every
// compilation and reissue since - Bush's Machinehead sits on 79 - while a
// remaster or a bootleg sits on one. Ranking by earliest date instead picks the
// bootleg: it dated Freezing Moon to a 1990 rehearsal and Breaking Up Is Hard
// to Do to a 1981 re-record.
//
// MusicBrainz asks for one request per second and a real User-Agent. Both are
// honoured; this is somebody's free service.

import { normalise } from './match.mjs';

export const UA = 'HitsterPool/1.0 (sjmarais@inrangegolf.com)';
export const PAUSE_MS = 1100;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REISSUE = /compilation|live|remix|dj-mix/i;

/**
 * The most-released recording, filtered to an exact artist and title match.
 * This is the independent signal. Returns { year, releases, why }.
 */
export async function byRecording(artist, title) {
  const q = `artist:"${artist.replace(/"/g, '')}" AND recording:"${title.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=25`;
  return query(url, 'recordings', artist, title, () => true, 'most-released');
}

/**
 * The earliest release-group. This is what the generator used; see the header
 * on why its agreement with our data proves nothing.
 */
export async function byReleaseGroup(artist, title) {
  const q = `artist:"${artist.replace(/"/g, '')}" AND releasegroup:"${title.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(q)}&fmt=json&limit=25`;
  return query(url, 'release-groups', artist, title,
    (g) => !(g['secondary-types'] ?? []).some((t) => REISSUE.test(t)), 'earliest');
}

async function query(url, key, artist, title, keep, rank) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!response.ok) return { year: null, releases: 0, why: `http ${response.status}` };
    const body = await response.json();

    const wantTitle = normalise(title);
    const wantArtist = normalise(artist);

    // The exact artist match is what keeps a cover from inheriting its
    // original's date - Dinosaur Jr.'s Just Like Heaven is 1989, not The Cure's
    // 1987. normalise() also folds the curly apostrophe in Beggin', which
    // MusicBrainz and Spotify spell differently.
    const candidates = (body[key] ?? [])
      .filter((item) => {
        if (normalise(item.title ?? '') !== wantTitle) return false;
        const credited = (item['artist-credit'] ?? []).map((a) => normalise(a.name ?? ''));
        if (!credited.some((a) => a === wantArtist)) return false;
        return keep(item);
      })
      .map((item) => ({
        year: Number(String(item['first-release-date'] ?? '').slice(0, 4)),
        releases: (item.releases ?? []).length,
      }))
      .filter((c) => c.year > 1900 && c.year < 2030);

    if (!candidates.length) return { year: null, releases: 0, why: 'no exact artist+title match' };

    if (rank === 'most-released') {
      // Ties break to the earlier year: two recordings carried equally often are
      // the same performance, and the first date is the release.
      const best = candidates.sort((a, b) => b.releases - a.releases || a.year - b.year)[0];
      return { year: best.year, releases: best.releases, why: 'ok' };
    }
    const year = Math.min(...candidates.map((c) => c.year));
    return { year, releases: candidates.find((c) => c.year === year)?.releases ?? 0, why: 'ok' };
  } catch (error) {
    return { year: null, releases: 0, why: error.message };
  }
}
