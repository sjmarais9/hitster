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

// Familiarity is cumulative. A crowd that knows its music should still get the
// obvious songs, so widening never drops the easier tiers.
export const LEVELS = {
  casual: { label: 'Casual', hint: 'The obvious ones', tiers: ['standard'] },
  confident: { label: 'Confident', hint: 'Plus well-known songs', tiers: ['standard', 'familiar'] },
  everything: { label: 'Encyclopaedic', hint: 'Everything, including deep cuts', tiers: ['standard', 'familiar', 'deep'] },
};

export const CROWDS = {
  everyone: { label: 'Everyone', hint: 'No restriction', skews: ['even', 'adults', 'kids'] },
  withKids: { label: 'Playing with kids', hint: 'Nothing only the adults would know', skews: ['even', 'kids'] },
  adultsOnly: { label: 'Adults only', hint: 'Nothing aimed at the children', skews: ['even', 'adults'] },
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
  crowd: 'everyone',
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

export function apply(pool, filters) {
  const tiers = LEVELS[filters.level]?.tiers ?? DEFAULTS.level;
  const skews = CROWDS[filters.crowd]?.skews ?? CROWDS.everyone.skews;

  return pool.filter((song) => {
    // An untagged song is playable rather than invisible; the tags are ours and
    // may lag the pool. Only an explicit tag can exclude a song.
    if (song.familiarity && !tiers.includes(song.familiarity)) return false;
    if (song.skew && !skews.includes(song.skew)) return false;
    if (!filters.decades.includes(song.decade)) return false;
    return groupsFor(song).some((g) => filters.genres.includes(g));
  });
}

/** A short line for the UI, e.g. "Confident, playing with kids, 4 decades". */
export function describe(filters) {
  const parts = [LEVELS[filters.level]?.label ?? 'All'];
  if (filters.crowd !== 'everyone') parts.push(CROWDS[filters.crowd].label.toLowerCase());

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
