// Tailoring the deck to whoever is at the table.
//
// The pool is deliberately large and mostly deep cuts, which is only playable
// because a game can narrow it. Three dimensions, chosen because they map to
// real questions people ask before a game rather than to fields in the schema:
//
//   "how well does this crowd know their music" -> familiarity
//   "are the kids playing"                      -> skew
//   "what era / what kind of music"             -> decades and genres
//
// Filters are preferences rather than session state, so unlike the auth tokens
// they live in localStorage and survive closing the tab.

const STORAGE_KEY = 'hitster.filters';

// Familiarity and skew are no longer filters. They weight the draw instead, in
// scoring.js, so a song is made less likely rather than removed. Nothing is
// excluded for being slightly too obscure or slightly too grown-up.
//
// Only decade and genre still exclude, because "no 1960s tonight" is a
// statement about what the table wants to hear rather than a difficulty
// setting, and a probabilistic version of it would just be baffling.
// Imported as well as re-exported: `export ... from` forwards the binding
// without introducing it locally, and describe() below needs to read it.
import { LEVELS } from './scoring.js';

export { LEVELS };

// The crowd control is a position from 0 to 1 rather than a set of options:
// 0 draws only what the adults know, 1 only what the children know, and the
// middle produces a genuinely even mix rather than mirroring the pool's own
// lopsidedness. See skewWeights in scoring.js.
export const CROWD = {
  min: 0,
  max: 1,
  step: 0.05,
  labelFor(position) {
    if (position <= 0.05) return 'Adults only';
    if (position < 0.35) return 'Mostly adults';
    if (position <= 0.65) return 'Balanced';
    if (position < 0.95) return 'Mostly kids';
    return 'Kids only';
  },
};

export const DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

// Grouped rather than raw, because the pool carries well over a hundred
// distinct genre strings and nobody wants to pick from that at a table.
export const GENRE_GROUPS = {
  rock: { label: 'Rock & alternative', match: /rock|punk|grunge|britpop|indie|new wave|shoegaze|madchester/i },
  metal: { label: 'Metal', match: /metal/i },
  pop: { label: 'Pop', match: /pop/i },
  hiphop: { label: 'Hip hop & R&B', match: /hip hop|rap|r&b|grime|trap/i },
  electronic: { label: 'Electronic & dance', match: /electronic|house|techno|edm|dance|trance|dubstep|big beat|trip hop|downtempo|eurodance/i },
  soul: { label: 'Soul, funk & disco', match: /soul|funk|disco|motown|jazz|blues/i },
  folk: { label: 'Country & folk', match: /country|folk/i },
  african: { label: 'African', match: /kwaito|amapiano|afro|isicathamiya|worldbeat|gqom|bubblegum/i },
  other: { label: 'Everything else', match: null },
};

export const DEFAULTS = {
  level: 'everything',
  crowd: 0.5,
  decades: [...DECADES],
  genres: Object.keys(GENRE_GROUPS),
};

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Merge over defaults so a filter added in a later version does not leave
    // an old saved selection with a missing key and an empty pool.
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(filters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Private browsing, quota, whatever. Filters just will not persist.
  }
}

/** Which genre groups a song belongs to. Falls back to `other`. */
function groupsFor(song) {
  const matched = Object.entries(GENRE_GROUPS)
    .filter(([, group]) => group.match && song.genres?.some((g) => group.match.test(g)))
    .map(([key]) => key);
  return matched.length > 0 ? matched : ['other'];
}

/**
 * The songs eligible to be drawn at all. Familiarity and skew are deliberately
 * absent: they shape the odds, not the deck.
 */
export function apply(pool, filters) {
  return pool.filter((song) => {
    if (!filters.decades.includes(song.decade)) return false;
    return groupsFor(song).some((g) => filters.genres.includes(g));
  });
}

/** A short line for the UI, e.g. "Confident · mostly kids · 4 decades". */
export function describe(filters) {
  const parts = [LEVELS[filters.level]?.label ?? 'All'];

  const crowd = CROWD.labelFor(filters.crowd ?? 0.5);
  if (crowd !== 'Balanced') parts.push(crowd.toLowerCase());

  const decades = filters.decades.length;
  if (decades !== DECADES.length) {
    parts.push(decades === 1 ? filters.decades[0] : `${decades} decades`);
  }

  const genres = filters.genres.length;
  if (genres !== Object.keys(GENRE_GROUPS).length) {
    parts.push(genres === 1 ? GENRE_GROUPS[filters.genres[0]].label.toLowerCase() : `${genres} genres`);
  }

  return parts.join(' · ');
}
