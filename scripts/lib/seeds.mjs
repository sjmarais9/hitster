// The judgements the generator makes about a candidate, separated so they can
// be tested without an API on the other end.
//
// These four decide what enters the pool and how it is weighted from then on.
// The skew seed in particular got it wrong across 5,668 songs before anyone
// noticed, and it was wrong in a way no error could surface: every value it
// produced was valid, they were simply all on one side.

/** Rounded to the decade a year belongs to, as the schema writes it. */
export const decadeOf = (year) => `${Math.floor(year / 10) * 10}s`;

/** The first and last year of a decade label, for the cross-check. */
export const DECADE_YEARS = {
  '1950s': [1950, 1959], '1960s': [1960, 1969], '1970s': [1970, 1979],
  '1980s': [1980, 1989], '1990s': [1990, 1999], '2000s': [2000, 2009],
  '2010s': [2010, 2019], '2020s': [2020, 2029],
};

/**
 * The era the crowd puts a song in, from the decade-themed playlists it appears
 * on. Independent of MusicBrainz, which is the whole point: two unrelated
 * sources agreeing is the evidence.
 *
 * A weak plurality is not evidence. Two decades splitting the vote say nothing
 * about which is right, so below the threshold this returns nothing rather than
 * a guess.
 */
export const PLURALITY = 0.4;

export function crowdDecade(entry) {
  const counts = Object.entries(entry.decades ?? {});
  if (!counts.length) return null;
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const [decade, n] = counts.sort((a, b) => b[1] - a[1])[0];
  return n / total >= PLURALITY ? decade : null;
}

/** Up to two genres, from the themes the song actually appeared on. */
export function genresOf(entry) {
  const counts = Object.entries(entry.genres ?? {});
  if (!counts.length) return ['pop'];
  return counts.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
}

/** Does a dated year agree with the era the playlists put the song in? */
export function agreesWithEra(year, era) {
  const [lo, hi] = DECADE_YEARS[era] ?? [0, 9999];
  return year >= lo && year <= hi;
}

// --- the seeds ---------------------------------------------------------------

export const STANDARD = 85;
export const FAMILIAR = 45;

/**
 * Global playlist counts overstate what this household knows in one genre.
 *
 * A review of twenty songs on 15 August found 80% of the hip hop and R&B tagged
 * as better known than it is, against 33% of everything else - and every single
 * correction in that genre went downward. Terror Squad's Lean Back and 50 Cent's
 * Ayo Technology both entered as `standard`, which is a US chart position rather
 * than anything a table in Johannesburg would shout at.
 *
 * Twelve points is the gap the review actually showed, not a guess: it is what
 * moves those songs to where the corrections put them without disturbing the
 * ones that were already right.
 *
 * This is a correction for one household's taste, which is exactly what a seed
 * should encode and exactly what a global measurement cannot.
 */
export const URBAN = /hip hop|rap|r&b|grime|trap/i;
export const URBAN_DAMPING = 12;

export const familiarityFor = (percentile, genres = []) => {
  const seen = URBAN.test(genres.join(' ')) ? percentile - URBAN_DAMPING : percentile;
  return seen >= STANDARD ? 'standard' : seen >= FAMILIAR ? 'familiar' : 'deep';
};

/**
 * Which side of the table a song favours.
 *
 * This came from the year alone once - pre-2005 adults, then even, then kids
 * from 2015 - which faithfully reproduced a mistake in the hand-tagging it was
 * measured from. `kids` had been read as "music from the children's era" rather
 * than "music the children know", so every decade before 2000 came out 99%
 * adults. The crowd slider is normalised by population, so Balanced then had to
 * find half the night from a side holding nothing older than Hey Ya, and the
 * 1990s fell to 13.4% of the draw.
 *
 * Canonicity fixes it without pretending to know the family: a pre-2005 song in
 * the top third of its decade is one that crossed generations, which is what
 * rule 8 in docs/tagging.md means by shared.
 */
// Raised from 65 after a second review, of twenty pre-2005 songs the old
// threshold had tagged `even`. Twenty out of twenty said otherwise: seven
// "adults only", thirteen "nobody here", not one "both". A song in the top
// third of 2001 is not thereby something a ten-year-old knows.
//
// Moved to 80 rather than to what the sample literally implies, because the
// sample was one adult answering on their children's behalf and had already
// been shown wrong that way once - Coi Leray's Players came back "I don't know
// it" from the parent while the children know it perfectly well. A partial move
// leaves room for that to be true here too.
export const SHARED = 80;

export const skewFor = (year, percentile) => {
  if (year >= 2015) return 'kids';
  if (year >= 2005) return 'even';
  return percentile >= SHARED ? 'even' : 'adults';
};
