// How a song's chance of being drawn is decided.
//
// Two dimensions, computed independently and multiplied:
//
//   familiarity  how likely this crowd is to know the song
//   skew         whether it favours the adults or the children
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
// well-known songs. This is the whole of what the three UI levels do, and it is
// the main dial for tuning how a night plays without touching any song data.
export const LEVELS = {
  casual: { label: 'Casual', hint: 'Mostly songs everyone knows', k: 4 },
  confident: { label: 'Confident', hint: 'A fair spread', k: 2 },
  everything: { label: 'Encyclopaedic', hint: 'Deep cuts included', k: 0 },
};

// --- skew --------------------------------------------------------------------

const KIDSNESS = { adults: 0, even: 0.5, kids: 1 };

/**
 * Weights for the crowd slider, 0 = adults only, 1 = kids only.
 *
 * Normalised by how many songs sit on each side. Without that, a slider that
 * merely "favours kids" still produces a mostly-adults draw, because the pool is
 * about 80% adults-skewed - so the slider would set a preference nobody could
 * see. Normalised, it sets the actual mix of what comes up.
 */
function skewWeights(deck, position) {
  let adultSide = 0;
  let kidsSide = 0;
  for (const song of deck) {
    const k = KIDSNESS[song.skew] ?? 0.5;
    adultSide += 1 - k;
    kidsSide += k;
  }
  // An empty side would divide by zero and take the whole draw with it.
  const a = adultSide || 1;
  const c = kidsSide || 1;

  return deck.map((song) => {
    const k = KIDSNESS[song.skew] ?? 0.5;
    return (1 - k) * ((1 - position) / a) + k * (position / c);
  });
}

// --- combining ---------------------------------------------------------------

/**
 * Relative draw weight for every song in the deck.
 * `level` names an entry in LEVELS; `crowd` is the slider position, 0 to 1.
 */
export function weightsFor(deck, { level = 'everything', crowd = 0.5 } = {}) {
  const k = LEVELS[level]?.k ?? 0;
  const skew = skewWeights(deck, crowd);

  return deck.map((song, i) => {
    const familiarity = scoreOf(song) ** k;
    return familiarity * skew[i];
  });
}

/**
 * Picks one song, weighted. `random` returns 0-1 and is injectable so tests can
 * assert on distributions rather than hope.
 */
export function pickWeighted(deck, weights, random = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return deck[Math.floor(random() * deck.length)] ?? null;

  let target = random() * total;
  for (let i = 0; i < deck.length; i++) {
    target -= weights[i];
    if (target <= 0) return deck[i];
  }
  // Floating point can leave a sliver unaccounted for at the very end.
  return deck[deck.length - 1];
}
