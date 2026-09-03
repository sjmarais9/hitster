// Decisions the scheduled import makes about its own run, separated so they can
// be tested without a Spotify account and a four-hour wait on the other side.

/**
 * Should canonicity be re-ranked after this run?
 *
 * canonicity is a within-decade percentile over the whole corpus, so every song
 * that lands changes the ranking of every song already there. src/scoring.js
 * blends it into scoreOf at 40%, which means a stale score is not cosmetic: it
 * is the draw weighting on a corpus that no longer exists.
 *
 * This was gated on `!hitQuota && !failed` and consequently never ran once in
 * nineteen importing runs. The quota is not a failure - it is how every
 * productive run ends and always will be, because the backlog is 7,300 songs
 * against a daily allowance of about 660. So the one condition that reliably
 * means "songs landed" was being read as the one that means "something went
 * wrong", and the refresh fired only on runs where nothing had changed.
 *
 * The real question is whether the pool changed. A run stopped by the quota has
 * still checkpointed everything it resolved, and that work is exactly what makes
 * the scores stale.
 *
 * A hard failure is different: the run died somewhere unknown, and re-ranking
 * the corpus on top of a half-written pool is how a bad score reaches the phone.
 */
export function shouldRefreshCanonicity({ failed, poolBefore, poolAfter }) {
  if (failed) return false;
  return poolAfter > poolBefore;
}

/**
 * Whether a review verdict is a fact about the song or about the moment.
 *
 * The distinction is the whole point of the reject cache. "Title and artist do
 * not match" is a fact: Spotify spells her Kesha and the batch says Ke$ha, and
 * that will be just as true next hour. "Lookup failed" is about the moment -
 * the network, the token, the quota - and caching it would turn one bad night
 * into a song permanently absent from the pool.
 *
 * Anything unrecognised is treated as transient, so a reason added later has to
 * be listed here deliberately before it can bury a song.
 */
export const PERMANENT = [
  { code: 'noMatch', test: /^title and artist do not match$|^no search results$/ },
  { code: 'partial', test: /^partial match/ },
  { code: 'unplayable', test: /not playable|unavailable in/i },
];

export const permanentReason = (problem) =>
  PERMANENT.find((r) => r.test.test(String(problem ?? '')))?.code ?? null;
