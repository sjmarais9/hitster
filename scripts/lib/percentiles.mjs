// Ranking a signal within each decade, separated so it can be tested.
//
// Within decade, because raw counts across decades measure the platform rather
// than the song: a 1967 track and a 2015 track face completely different
// playlist populations and scrobbling userbases, and comparing them directly
// only rediscovers that Last.fm users are young.
//
// The distinction this module exists to keep straight is between a measured
// zero and no measurement. Collapsing the two is what inverted every score in
// the pool: seven thousand songs that had simply never been fetched were ranked
// below every song that had, and the tiers came out upside down.

/**
 * Percentile of each song within its own decade, 0-100.
 *
 * `valueOf` returning null means unmeasured, and those songs are left out of
 * the ranking entirely rather than treated as zero. They come back with no
 * percentile, and the caller decides what to do with a song this source cannot
 * speak for.
 */
export function percentiles(songs, valueOf) {
  const byDecade = new Map();
  for (const s of songs) {
    if (valueOf(s) === null || valueOf(s) === undefined) continue;
    if (!byDecade.has(s.decade)) byDecade.set(s.decade, []);
    byDecade.get(s.decade).push(s);
  }

  const out = new Map();
  for (const [, group] of byDecade) {
    // One song is not a ranking. The old guard against dividing by zero gave it
    // a percentile of 0 - the most obscure score there is - for the sole reason
    // that it had nobody to be compared with. That is the same mistake as
    // treating unmeasured as zero, one decade at a time, and it can happen for
    // real: a decade where only one song was ever fetched from a thin source.
    //
    // No comparison means no opinion. The blend below then leans on whichever
    // source does have something to say, and if none do, scoreOf lets the
    // household tag stand alone rather than diluting it with a made-up number.
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => valueOf(a) - valueOf(b));
    sorted.forEach((s, i) => out.set(s.id, (i / (sorted.length - 1)) * 100));
  }
  return out;
}

/**
 * The average of whichever sources had something to say about a song.
 *
 * A source that cannot speak for a song must not drag its score down: two
 * sources agreeing on 80 and one saying nothing is a score of 80, not 53.
 * Returns null when no source could rank it at all.
 */
export function blend(rankings, id) {
  const found = rankings.map((r) => r.get(id)).filter((x) => x !== undefined);
  if (!found.length) return null;
  return Math.round(found.reduce((a, b) => a + b, 0) / found.length);
}
