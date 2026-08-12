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

// Genre is a mixer now, not a set of switches. The families live in scoring.js
// with the weighting that uses them; this re-exports so the UI has one import.
//
// Switches could not express "mostly rock, some of everything", which is the
// actual preference. A fader can, and it moves that decision from the pool's
// composition - where it could only be changed by generating more songs - to a
// setting that can be tuned from how a night actually played.
// Imported as well as re-exported. `export ... from` forwards a binding without
// introducing it locally, and DEFAULTS and describe() below both read it. This
// is the second time that has bitten here.
import { GENRE_FAMILIES, familyOf } from './scoring.js';

export { GENRE_FAMILIES, familyOf };

// Every fader starts flat, so an untouched mixer reproduces exactly what the
// pool contains and nothing changes until something is deliberately moved.
export const DEFAULTS = {
  level: 'everything',
  crowd: 0.5,
  decades: [...DECADES],
  genreLevels: Object.fromEntries(Object.keys(GENRE_FAMILIES).map((k) => [k, 1])),
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

/**
 * The songs eligible to be drawn at all.
 *
 * Only decade excludes now. Familiarity, skew and genre all shape the odds
 * instead - a genre fader has to be pulled all the way to Off before anything
 * disappears, and that is a deliberate act rather than a side effect of moving
 * a control.
 */
export function apply(pool, filters) {
  return pool.filter((song) => filters.decades.includes(song.decade));
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

  // Only worth mentioning the mixer when it has actually been moved.
  const levels = filters.genreLevels ?? {};
  const muted = Object.keys(GENRE_FAMILIES).filter((k) => (levels[k] ?? 1) <= 0);
  const moved = Object.keys(GENRE_FAMILIES).filter((k) => {
    const v = levels[k] ?? 1;
    return v > 0 && v !== 1;
  });

  if (muted.length === 1) parts.push(`no ${GENRE_FAMILIES[muted[0]].label.toLowerCase()}`);
  else if (muted.length > 1) parts.push(`${muted.length} genres off`);
  if (moved.length) parts.push('mixed');

  return parts.join(' · ');
}
