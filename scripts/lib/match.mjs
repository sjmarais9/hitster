// Deciding whether a Spotify search result really is the song we asked for.
//
// The bar is deliberately high. A wrong URI is worse than no URI: a missing
// song is a gap in the pool, but a wrong one plays the wrong decade mid-round
// and quietly breaks the game. Anything short of an exact normalised match on
// both title and artist goes to the review file for a human to settle.

/**
 * Reduces a title or artist to comparable form. Strips the decorations Spotify
 * routinely adds — "(Remastered 2011)", "- Single Version", "feat. …" — none of
 * which change which recording we are looking at.
 */
export function normalise(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')       // accents, now split off by NFD
    .replace(/\(.*?\)|\[.*?\]/g, ' ')     // (Remastered), [Live]
    .replace(/\s-\s.*$/, ' ')             // "Title - 2011 Remaster"
    .replace(/\bfeat\.?\b.*$/, ' ')       // "feat. Bruno Mars"
    .replace(/\bft\.?\b.*$/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')          // apostrophes, punctuation
    .replace(/^the /, '')                 // "The Beach Boys" / "Beach Boys"
    .replace(/\s+/g, ' ')
    .trim();
}

function eitherContains(a, b) {
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

/** Spotify's release year, for reporting only. Never written to the pool. */
export function releaseYear(track) {
  const date = track.album?.release_date;
  return date ? Number(date.slice(0, 4)) : null;
}

/**
 * Grades one candidate against the song we wanted.
 * Returns { verdict: 'confident' | 'probable' | 'reject', reason }.
 */
export function grade(song, track) {
  const wantTitle = normalise(song.title);
  const gotTitle = normalise(track.name);
  const wantArtist = normalise(song.artist);
  const gotArtists = track.artists.map((a) => normalise(a.name));

  const titleExact = wantTitle === gotTitle;
  const titleLoose = eitherContains(wantTitle, gotTitle);
  const artistExact = gotArtists.includes(wantArtist);
  const artistLoose = gotArtists.some((a) => eitherContains(a, wantArtist));

  // market was passed on the search, so Spotify returns is_playable directly.
  // Only an explicit false is disqualifying; the field is absent on some
  // responses and absence is not evidence of unavailability.
  if (track.is_playable === false) {
    return { verdict: 'reject', reason: 'not playable in market' };
  }

  if (titleExact && artistExact) {
    return { verdict: 'confident', reason: 'exact title and artist' };
  }
  if ((titleExact && artistLoose) || (titleLoose && artistExact)) {
    const detail = `title ${titleExact ? 'exact' : 'loose'}, artist ${artistExact ? 'exact' : 'loose'}`;
    return { verdict: 'probable', reason: `partial match (${detail})` };
  }
  return { verdict: 'reject', reason: 'title and artist do not match' };
}

/**
 * Picks the best candidate from a search response.
 * Only a 'confident' result is safe to add to the pool automatically.
 */
export function pickBest(song, tracks) {
  const graded = tracks.map((track) => ({ track, ...grade(song, track) }));

  return graded.find((g) => g.verdict === 'confident')
    ?? graded.find((g) => g.verdict === 'probable')
    ?? graded[0]
    ?? null;
}
