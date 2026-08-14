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

// Nothing is a filter any more except a fader pulled fully to Off. Familiarity,
// skew, genre and decade all weight the draw instead, in scoring.js, so a song
// is made less likely rather than removed.
//
// Off is still a real exclusion, because "no 1960s tonight" is a statement about
// what the table wants to hear rather than a difficulty setting, and a
// probabilistic version of it would just be baffling.
// Imported as well as re-exported: `export ... from` forwards the binding
// without introducing it locally, and describe() below needs to read it.
import { LEVELS } from './scoring.js?v=e29056ff';

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

// Genre and decade are both mixers now, not sets of switches. The families and
// the decade list live in scoring.js with the weighting that uses them; this
// re-exports so the UI has one import.
//
// Switches could not express "mostly rock, some of everything", or "lean
// nineties", which are the actual preferences. Faders can, and they move that
// decision from the pool's composition - where it could only be changed by
// generating more songs - to a setting that can be tuned from how a night
// actually played.
// Imported as well as re-exported. `export ... from` forwards a binding without
// introducing it locally, and DEFAULTS and describe() below both read it. This
// is the third time that has bitten here.
import { GENRE_FAMILIES, DECADES, familyOf } from './scoring.js?v=e29056ff';

export { GENRE_FAMILIES, DECADES, familyOf };

const flat = (keys) => Object.fromEntries(keys.map((k) => [k, 1]));

// Every fader starts flat, so an untouched mixer reproduces exactly what the
// pool contains and nothing changes until something is deliberately moved.
export const DEFAULTS = {
  level: 'everything',
  crowd: 0.5,
  decadeLevels: flat(DECADES),
  genreLevels: flat(Object.keys(GENRE_FAMILIES)),
};

/**
 * Decades were switches before they were faders, and a saved selection still
 * carries the old `decades` array. Merging that over the defaults would leave
 * decadeLevels flat and quietly switch the 1960s back on for anyone who had
 * turned it off, so convert it rather than ignore it.
 *
 * Exported only so it can be tested directly; load() is the way in.
 */
export function migrate(saved) {
  if (Array.isArray(saved.decades) && !saved.decadeLevels) {
    saved.decadeLevels = Object.fromEntries(
      DECADES.map((d) => [d, saved.decades.includes(d) ? 1 : 0]));
  }
  delete saved.decades;
  return saved;
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    // Merge over defaults so a filter added in a later version does not leave
    // an old saved selection with a missing key and an empty pool.
    return { ...DEFAULTS, ...migrate(JSON.parse(raw)) };
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
 * Only a decade pulled fully to Off excludes. Everything else shapes the odds -
 * a fader has to be taken all the way down before anything disappears, and that
 * is a deliberate act rather than a side effect of nudging a control.
 *
 * Decade is the one that removes rather than merely zeroing, because the deck
 * count on screen should say how many songs are actually in play. A muted genre
 * stays in the deck so the mixer can be moved mid-session without the unplayed
 * set shifting under the player; a switched-off decade is a decision made before
 * the game starts.
 */
export function apply(pool, filters) {
  const levels = filters.decadeLevels ?? {};
  return pool.filter((song) => (levels[song.decade] ?? 1) > 0);
}

/** Which faders in a set are off, and which have merely been moved. */
function movement(keys, levels = {}) {
  const off = keys.filter((k) => (levels[k] ?? 1) <= 0);
  const moved = keys.filter((k) => {
    const v = levels[k] ?? 1;
    return v > 0 && v !== 1;
  });
  return { off, moved };
}

/** A short line for the UI, e.g. "Confident · mostly kids · 4 decades". */
export function describe(filters) {
  const parts = [LEVELS[filters.level]?.label ?? 'All'];

  const crowd = CROWD.labelFor(filters.crowd ?? 0.5);
  if (crowd !== 'Balanced') parts.push(crowd.toLowerCase());

  const decades = movement(DECADES, filters.decadeLevels);
  const live = DECADES.filter((d) => !decades.off.includes(d));
  if (decades.off.length) {
    parts.push(live.length === 1 ? live[0] : `${live.length} decades`);
  }

  // Only worth mentioning the mixers when they have actually been moved.
  const genres = movement(Object.keys(GENRE_FAMILIES), filters.genreLevels);
  if (genres.off.length === 1) parts.push(`no ${GENRE_FAMILIES[genres.off[0]].label.toLowerCase()}`);
  else if (genres.off.length > 1) parts.push(`${genres.off.length} genres off`);

  if (genres.moved.length || decades.moved.length) parts.push('mixed');

  return parts.join(' · ');
}
