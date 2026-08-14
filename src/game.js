// The deck. Everything else about the game — timelines, tokens, scoring, turn
// order — stays physical on the table, so this is only ever "which song next".

import { basePath } from './config.js?v=25fa6b28';
import { weightsFor, pickWeighted } from './scoring.js?v=25fa6b28';

// Per-tab, so closing the tab starts a fresh game. Survives a reload mid-game,
// which is the case that actually matters when a phone is being passed around.
const PLAYED_KEY = 'hitster.played';

export async function loadPool() {
  const response = await fetch(`${basePath()}data/songs.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Could not load the song pool.');

  const doc = await response.json();
  // Belt and braces: an entry without a verified URI must never be drawable.
  const songs = (doc.songs ?? []).filter((song) => song.spotify_uri);
  if (songs.length === 0) throw new Error('The song pool is empty.');
  return songs;
}

function played() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(PLAYED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function remember(uri) {
  const seen = played();
  seen.add(uri);
  sessionStorage.setItem(PLAYED_KEY, JSON.stringify([...seen]));
}

export function resetSession() {
  sessionStorage.removeItem(PLAYED_KEY);
}

/** How far into a game we are. Zero means nothing would be lost by starting over. */
export function playedCount() {
  return played().size;
}

/**
 * Draws a song not yet played this session, and records it.
 * Returns null when the deck is exhausted.
 *
 * Weights are computed over what is still unplayed rather than the whole deck,
 * so the crowd balance holds as the night goes on. Weighting the full deck and
 * then discarding played songs would let the mix drift once the small side -
 * usually the children's - had been used up.
 */
export function draw(pool, options = {}) {
  const seen = played();
  const available = pool.filter((song) => !seen.has(song.spotify_uri));
  if (available.length === 0) return null;

  const song = pickWeighted(available, weightsFor(available, options));

  // Songs remain, but every one of them is weighted to nothing - the mixers
  // have excluded whatever this decade selection left. That is a different
  // thing from an exhausted deck and deserves a different sentence, or the
  // player is told to start over when what they need is to turn a fader up.
  if (!song) {
    throw new Error('Every song left in this deck is switched off in the mixers. Turn a genre back up.');
  }

  remember(song.spotify_uri);
  return song;
}
