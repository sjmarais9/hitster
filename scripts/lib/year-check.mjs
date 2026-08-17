// Deciding whether a year in the data is wrong, from two sources that are
// wrong in different ways.
//
// Neither source can be trusted alone, and this is measured rather than
// assumed:
//
//   SPOTIFY dates a track by the release it is served from, which drifts late
//   towards remasters and reissues. An earlier date than ours is therefore
//   worth reading - but it is also how a cover gets caught, because the
//   earliest release carrying a title is often the original artist's. Spotify
//   put Dinosaur Jr.'s Just Like Heaven at 1987, which is The Cure.
//
//   MUSICBRAINZ recordings, ranked by how many releases carry them, disagreed
//   with our year by two or more on 21% of batch 006 - and in the direction
//   that says we are too early, which was 15.8% of the batch, every case read
//   was MusicBrainz's fault and not ours. Its coverage of anything before 1990
//   is a CD reissue, because nothing earlier was catalogued. Release count does
//   not save it: Eric Carmen's wrong entry carries 140.
//
// So neither votes alone. What earns a correction is both of them landing on
// the same earlier year, which is a thing that does not happen by accident:
// they are independent catalogues with unrelated failure modes, and the one
// trap they might share - a cover - is broken by MusicBrainz filtering on an
// exact artist match where Spotify's search does not.
//
// Replayed against the nine suspects of 16 August, six of which were genuinely
// wrong: four corrections, all four right, and no false correction on any of
// the three where our year was already correct. It misses Ramones and Mayhem,
// which is the trade being made - a rule that catches those two also fires on
// Sedaka and Dinosaur Jr., and a wrong correction is worse than a missed one.
// The misses do not vanish; they surface as `check` for a human.

/** Both sources must be this many years earlier before anything is claimed. */
export const MARGIN = 2;

/** And they must land within this of each other to count as agreeing. */
export const TOLERANCE = 1;

/**
 * Below this a date is a placeholder rather than a year.
 *
 * Spotify returns 1900 when it does not know, and it is not marked as unknown
 * in any way the response distinguishes - Cutty Ranks' Limb By Limb came back
 * 1900 on 17 August. Read literally that is a source claiming a 93-year error.
 * It landed harmlessly then, because MusicBrainz backed our year and the verdict
 * came out `contradicted`, but a second placeholder on the other side would have
 * read as two sources agreeing.
 *
 * The pool's oldest song is from the 1950s, so nothing real is lost here.
 */
export const PLAUSIBLE_FROM = 1940;

const usable = (y) => (typeof y === 'number' && y >= PLAUSIBLE_FROM ? y : null);

/**
 * What the sources say about one song's year.
 *
 * `confirmed` - both sources agree our year is too late. Safe to act on.
 * `check`     - one source disputes it and the other cannot corroborate.
 *               A human decides; most of these are the disputing source's
 *               error, not ours.
 * `contradicted` - one source disputes it and the other backs our year.
 *               Recorded so it can be ranked last rather than re-litigated.
 * `ok`        - nothing disputes it.
 */
export function classifyYear({ ours, spotify: rawSpotify = null, musicbrainz: rawMusicbrainz = null }) {
  const spotify = usable(rawSpotify);
  const musicbrainz = usable(rawMusicbrainz);

  const disputes = (y) => y !== null && y <= ours - MARGIN;
  const backs = (y) => y !== null && Math.abs(y - ours) <= TOLERANCE;

  const spDisputes = disputes(spotify);
  const mbDisputes = disputes(musicbrainz);

  if (spDisputes && mbDisputes && Math.abs(spotify - musicbrainz) <= TOLERANCE) {
    // The earlier of two agreeing dates. They differ by at most a year, and
    // where they do it is a pressing date against a release date - Mayhem's
    // album is 1994 and MusicBrainz's earliest pressing of it is 1995.
    return { verdict: 'confirmed', year: Math.min(spotify, musicbrainz), sources: 2 };
  }

  if (spDisputes || mbDisputes) {
    const other = spDisputes ? musicbrainz : spotify;
    const disputed = spDisputes ? spotify : musicbrainz;
    const by = spDisputes ? 'spotify' : 'musicbrainz';
    if (backs(other)) {
      return { verdict: 'contradicted', year: disputed, sources: 1, disputedBy: by };
    }
    return { verdict: 'check', year: disputed, sources: 1, disputedBy: by };
  }

  return { verdict: 'ok', year: ours, sources: 0 };
}

/** Ranked worst first, so a review list reads top down. */
export const RANK = { confirmed: 0, check: 1, contradicted: 2, ok: 3 };

export const bySeverity = (a, b) => (RANK[a.verdict] - RANK[b.verdict])
  || ((b.our_year - b.year) - (a.our_year - a.year));
