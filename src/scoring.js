// How a song's chance of being drawn is decided.
//
// Four dimensions, computed independently and multiplied:
//
//   familiarity  how likely this crowd is to know the song
//   skew         whether it favours the adults or the children
//   genre        the mixer
//   decade       the other mixer
//
// Both are weights rather than filters. A song is never excluded for being
// slightly too obscure or slightly too grown-up, only made less likely. That
// matters because our tags are wrong often enough - four review rounds found
// correction rates between 25% and 55% - and a weighted system degrades
// gracefully where a filter would make a mis-tagged song vanish entirely.

// --- familiarity -------------------------------------------------------------

// Two sources disagree about how well known a song is: our own tag, which knows
// this household but is one person's judgement, and measured canonicity, which
// knows the world but has never met the family. Neither wins outright.
//
// TRUST is how much the household tag counts. At 1.0 the measurement is
// decorative; at 0.5 global data starts overruling things the owner has said
// directly about his own family. 0.6 keeps local knowledge ahead while letting
// canonicity genuinely bite - it moves about 6% of songs across a tier boundary.
export const TRUST = 0.6;

const TAG_SCORE = { standard: 10, familiar: 6, deep: 2 };
const UNTAGGED = 6;

/** 1-10. Higher means more likely to be known. */
export function scoreOf(song) {
  const tag = TAG_SCORE[song.familiarity] ?? UNTAGGED;
  // No measurement means nothing to blend with, so the tag stands alone rather
  // than being diluted toward the middle by a made-up number.
  if (song.canonicity === null || song.canonicity === undefined) return tag;
  const canon = 1 + 9 * (song.canonicity / 100);
  return TRUST * tag + (1 - TRUST) * canon;
}

// The exponent applied to the score. Higher means a sharper preference for
// well-known songs. This is the whole of what the UI levels do, and it is the
// main dial for tuning how a night plays without touching any song data.
//
// Retuned on 29 August 2026, on a 9,430-song pool, after a night of Casual
// played harder than the label promises. The useful measure turned out not to
// be the `deep` share - a tag - but the share of the draw below canonicity 60,
// which is roughly where a song stops being one the table can shout at:
//
//        k     below canon 60     `deep` share
//   Casual         6.0%               0.4%
//   Confident     17.3%               4.6%
//   Devoted       30.7%              16.0%
//   Encyclo.      46.3%              33.0%
//
// Every rung moved. The old ladder was fitted when the pool held 1,649 songs
// and nearly all of them had been chosen by hand; it now holds 9,430, of which
// 85% arrived from a playlist index. The same k against a corpus that much
// broader is a different game, and Casual had drifted to 12.3% below canon 60 -
// about one card in eight, or three a night, which is what was actually felt.
//
// These figures move as the pool grows. scripts/stats.mjs and the level test
// both recompute rather than quoting, because the last set of numbers written
// into this comment was stale within a fortnight.
export const LEVELS = {
  casual: { label: 'Casual', hint: 'Mostly songs everyone knows', k: 6 },
  confident: { label: 'Confident', hint: 'A fair spread', k: 3 },
  devoted: { label: 'Devoted', hint: 'Album tracks, not just singles', k: 1.5 },
  // No longer k=0. Perfectly flat was an honest claim on a curated pool and an
  // unplayable one here: every song equally likely now means 56% of the night
  // below canonicity 60, which is not a harder game but a different and worse
  // one - four in seven cards nobody can place. k=0.5 still reaches the whole
  // pool and still favours almost nothing, and the label can now say what it
  // actually deals rather than making the stronger claim.
  everything: { label: 'Encyclopaedic', hint: 'Deep cuts and forgotten singles', k: 0.5 },
};

// --- skew --------------------------------------------------------------------

const KIDSNESS = { adults: 0, even: 0.5, kids: 1 };

/**
 * The slider position, coerced to something arithmetic can use.
 *
 * A saved setting from an older version holds `crowd: 'everyone'`, and one
 * non-numeric value turns every weight into NaN, which collapses the whole
 * deck. That used to be masked by pickWeighted falling back to a uniform draw -
 * so a garbled setting produced a working game, silently ignoring every control
 * on the screen. With that fallback gone the mask is gone too, and the value
 * has to be made sound here rather than survive by accident.
 */
export function position(crowd) {
  // null and undefined both mean "not set", so both take the default. Number()
  // disagrees - it reads null as 0, i.e. Adults only - and since the callers
  // write `crowd ?? 0.5`, a stored null would have labelled the slider Balanced
  // while the draw excluded every child in the pool.
  if (crowd === null || crowd === undefined) return 0.5;
  const n = Number(crowd);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/**
 * Weights for the crowd slider, 0 = adults only, 1 = kids only.
 *
 * Normalised by how much weight sits on each side. Without that, a slider that
 * merely "favours kids" still produces a mostly-adults draw, because the pool is
 * about 80% adults-skewed - so the slider would set a preference nobody could
 * see. Normalised, it sets the actual mix of what comes up.
 *
 * `rest` is every other factor: familiarity, genre, decade. It has to be here.
 *
 * This used to normalise by raw song counts and then get multiplied by those
 * factors afterwards, which destroyed the invariant before the draw ever saw
 * it - because they correlate with skew. The children's songs are recent, and
 * recent songs score differently, so favouring well-known music silently
 * favoured the children too. Measured on the real pool, "Balanced" on Casual
 * gave the kids side 67% of the night:
 *
 *          slider 0.25   slider 0.50   slider 0.75
 *   Casual       0.406         0.672         0.860
 *   Confident    0.351         0.619         0.830
 *   Devoted      0.306         0.569         0.799
 *   Encyclo.     0.250         0.500         0.750
 *
 * Only the bottom row was ever right. Weighting each side by the mass it
 * actually carries makes every row read 0.25 / 0.50 / 0.75.
 */
function skewWeights(deck, at, rest) {
  let adultSide = 0;
  let kidsSide = 0;
  deck.forEach((song, i) => {
    const k = KIDSNESS[song.skew] ?? 0.5;
    adultSide += rest[i] * (1 - k);
    kidsSide += rest[i] * k;
  });
  // An empty side would divide by zero and take the whole draw with it. So
  // would a side whose every song has been weighted to nothing by a muted
  // genre, which counting songs could not see.
  const a = adultSide || 1;
  const c = kidsSide || 1;

  return deck.map((song) => {
    const k = KIDSNESS[song.skew] ?? 0.5;
    return (1 - k) * ((1 - at) / a) + k * (at / c);
  });
}

// --- genre -------------------------------------------------------------------

// The mixer. One fader per family, flat at 1 by default so an untouched mixer
// draws the pool exactly as it is.
//
// Deliberately NOT normalised by family size, unlike the crowd slider. There
// the imbalance is an artefact worth correcting: the pool is 80% adults-skewed
// only because of what has been generated, and the children deserve an even
// game regardless. Here the sizes are real: rock outnumbers African by roughly
// a hundred to one, and normalising would make a flat mixer give both the same
// airtime - those few songs would repeat all night. A fader raises how likely
// each song of a family is, and cannot conjure a mix the pool cannot sustain.
export const GENRE_FAMILIES = {
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

// Nine families, each a regex over every genre a song carries, is up to ninety
// tests per song. Fine once; the live mix readout recomputes on every drag of
// every fader, and at ten thousand songs that was enough to make the faders
// stutter on a phone. A song's family cannot change while the app is running.
const familyCache = new WeakMap();

/**
 * One family per song, first match wins. Disjoint on purpose: a song counted in
 * two families would be double-weighted and quietly over-drawn.
 */
export function familyOf(song) {
  const cached = familyCache.get(song);
  if (cached) return cached;

  let found = 'other';
  for (const [key, family] of Object.entries(GENRE_FAMILIES)) {
    if (family.match && song.genres?.some((g) => family.match.test(g))) { found = key; break; }
  }
  familyCache.set(song, found);
  return found;
}

function genreWeights(deck, levels) {
  return deck.map((song) => {
    // Absent from the saved settings means untouched, which means flat.
    const level = levels?.[familyOf(song)] ?? 1;
    // Exactly zero is the mixer's Off position and genuinely excludes. Every
    // other value only changes how likely a song is.
    return level > 0 ? level : 0;
  });
}

// --- decade ------------------------------------------------------------------

export const DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

// Decades were on/off switches until the generator changed what the pool looked
// like. Every batch written by hand sat at about 24% 1990s against 18% 2000s,
// which is the mix this table asked for. Generated batch 006 came back at 18.6%
// against 24.4% - not a judgement it made, but one it inherited from Deezer,
// whose playlists over-represent recent music. At 5,793 of 7,513 songs its bias
// simply became the pool's.
//
// A fader is the right place to correct that. Regenerating to hit a target mix
// would mean discarding good songs for having the wrong date, and would have to
// be done again every time the pool grew.
//
// Not normalised by decade size, for the same reason the genre mixer is not:
// the 1950s holds fourteen songs, and a flat normalised mixer would hand them
// an eighth of the night. A fader raises how likely each song of a decade is,
// and cannot conjure a mix the pool has no songs for.
function decadeWeights(deck, levels) {
  return deck.map((song) => {
    const level = levels?.[song.decade] ?? 1;
    return level > 0 ? level : 0;
  });
}

// --- combining ---------------------------------------------------------------

/**
 * Relative draw weight for every song in the deck.
 * `level` names an entry in LEVELS; `crowd` is the slider position, 0 to 1.
 */
export function weightsFor(deck, {
  level = 'everything', crowd = 0.5, genreLevels, decadeLevels,
} = {}) {
  const k = LEVELS[level]?.k ?? 0;
  const genre = genreWeights(deck, genreLevels);
  const decade = decadeWeights(deck, decadeLevels);

  // Everything except skew, computed first, because the crowd slider has to
  // normalise against the mass these produce rather than against a song count.
  // Multiplying a count-normalised skew by these afterwards is what made the
  // slider a suggestion instead of a setting.
  const rest = deck.map((song, i) => scoreOf(song) ** k * genre[i] * decade[i]);
  const skew = skewWeights(deck, position(crowd), rest);

  return deck.map((_, i) => rest[i] * skew[i]);
}

/**
 * Each group's expected share of the draw under the current settings.
 *
 * The faders are multipliers, so their own readout ("1.4×") answers a question
 * nobody at the table is asking. What is actually wanted is whether the
 * nineties are back up to a quarter of the night yet, and that depends on the
 * other faders too - weighting rock up pulls the decades along with it, because
 * genre and era are not independent.
 *
 * Computed from the same weights the draw uses, so the number on screen cannot
 * drift from what the deck goes on to do.
 */
export function projectedShares(deck, options, groupOf) {
  const weights = weightsFor(deck, options);
  const total = weights.reduce((a, b) => a + b, 0);

  const shares = {};
  if (!(total > 0)) return shares;
  deck.forEach((song, i) => {
    const group = groupOf(song);
    shares[group] = (shares[group] ?? 0) + weights[i] / total;
  });
  return shares;
}

/**
 * Picks one song, weighted. `random` returns 0-1 and is injectable so tests can
 * assert on distributions rather than hope.
 */
export function pickWeighted(deck, weights, random = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);

  // Nothing is eligible. This used to fall back to a uniform draw, on the
  // reasoning that refusing to deal is worse than dealing something - but what
  // it actually did was deal the songs the player had just switched off, while
  // their labels read Off and the share readout said 0%.
  //
  // It is reachable without muting everything: one decade plus four genre
  // faders leaves a thirteen-song deck whose whole weight is zero, and 9,238 of
  // 10,000 draws came from families set to Off. Returning nothing lets the
  // caller say so instead of quietly contradicting the controls.
  if (!(total > 0)) return null;

  let target = random() * total;
  for (let i = 0; i < deck.length; i++) {
    target -= weights[i];
    if (target <= 0) return deck[i];
  }
  // Floating point can leave a sliver unaccounted for at the very end.
  return deck[deck.length - 1];
}
