import { TOLERANCE } from './year-check.mjs';
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
 * than anything a table in Stellenbosch would shout at.
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

/**
 * The 2005-2014 band used to return `even` for everything, on the year alone.
 * 2,390 songs rested on that, and a calibration round of thirty songs found it
 * the worst thing in the data: eight of ten wrong, seven of them songs the
 * children would not know. Consulting canonicity took the same ten from 2/10
 * to 7/10 correct.
 *
 * So the band is not special. A song is shared if it crossed generations,
 * whether it came out in 1975 or 2010, and the year only decides the one thing
 * a year genuinely settles: music released after the children could listen to
 * it themselves is theirs.
 */
export const skewFor = (year, percentile) => {
  if (year >= 2015) return 'kids';
  return percentile >= SHARED ? 'even' : 'adults';
};

// A version suffix is decoration on a title, not a different song. Deezer's
// playlists carry whichever pressing the curator happened to add, so the index
// holds "Should I Stay or Should I Go (Remastered)" and "Ain't Nobody (Remix)"
// rather than the songs themselves.
//
// JUNK read those as junk, which they are not: a remaster of a famous single is
// the famous single. 1,651 candidates on five or more playlists were being
// turned away that way, and because JUNK filters before the reject cache ever
// sees them, they were never recorded as tried - so every run rediscovered and
// re-discarded the same songs in silence. What was left to import instead had a
// median canonicity of 24.
//
// Stripped first, then tested. Anything still matching JUNK afterwards is the
// real thing - an actual karaoke or tribute recording - and is still refused.
export const VERSION_SUFFIX = /\s*[([][^)\]]*\b(remaster(ed)?|remix|mix|edit|version|mono|stereo|single|radio|club|extended|re-?recorded|deluxe|bonus|\d{4})\b[^)\]]*[)\]]|\s*-\s*(\d{4}\s*)?(remaster(ed)?|remix|mono|stereo|single|radio|club|extended|version)\b.*$/gi;

export const cleanTitle = (title) => String(title).replace(VERSION_SUFFIX, '').trim();

/**
 * The year to use, and whether a second source stood behind it.
 *
 * The generator has always cross-checked its year against the decade the song's
 * playlists put it in, and rejected a mismatch. That check exists because a
 * wrong year is the one error that genuinely breaks this game, and it is worth
 * keeping - but it is a weak witness, and it was the only one.
 *
 * It is weakest exactly where it is asked most. A song that spans eras collects
 * playlists from all of them: YMCA is a 1978 record living on seventies lists,
 * eighties lists and party lists, so the plurality that decides its "era" can
 * land on the wrong decade while the year itself is not in doubt at all. 3,558
 * candidates were refused that way and 496 of them appear on twenty or more
 * playlists - Start Me Up, Knockin' On Heaven's Door, Landslide, Sit Down.
 *
 * So: ask the date sources whether they agree with each other first. Two
 * independent catalogues landing on the same year is far stronger evidence than
 * a playlist plurality, and it is the same rule year-check.mjs already applies
 * to the pool - agreement within TOLERANCE, and the earlier of the two, because
 * the later one is usually a reissue.
 *
 * A year with no corroboration still faces the era check. This widens what gets
 * in; it does not lower the bar for a year nobody can second.
 */
export function reconcileYear(years) {
  const found = Object.entries(years)
    .filter(([, y]) => Number.isInteger(y))
    .map(([source, y]) => ({ source, year: y }));

  if (found.length === 0) return null;
  if (found.length === 1) return { year: found[0].year, corroborated: false };

  // Any two within TOLERANCE corroborate each other. Sorted first so the pair
  // that agrees is found in year order and the earlier one is the one taken.
  const sorted = [...found].sort((a, b) => a.year - b.year);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].year - sorted[i - 1].year <= TOLERANCE) {
      return { year: sorted[i - 1].year, corroborated: true, sources: [sorted[i - 1].source, sorted[i].source] };
    }
  }

  // They disagree. MusicBrainz is the catalogue rather than a store front, so
  // it leads - but nothing is corroborated, and the era check still has to pass.
  const preferred = found.find((f) => f.source === 'musicbrainz') ?? found[0];
  return { year: preferred.year, corroborated: false };
}
