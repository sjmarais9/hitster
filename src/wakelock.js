// Keeps the screen on during a round.
//
// Nobody touches the phone while a song plays, so Android would dim and lock it
// mid-round every single time. The lock is dropped automatically whenever the
// tab is hidden, which is the behaviour we want; it just has to be taken again
// on the way back.

let lock = null;
let wanted = false;

async function acquire() {
  if (!('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch {
    // Refused, or unsupported on this browser. The game still works; the screen
    // just behaves normally. Not worth interrupting anyone over.
  }
}

export function keepAwake() {
  wanted = true;
  return acquire();
}

/**
 * Gives the screen back.
 *
 * There was no way to do this, so the lock was taken on the first Start and
 * held for the life of the page - across the menu, across the deck screen,
 * across an exhausted deck - with the visibilitychange handler faithfully
 * re-acquiring it forever. The README says it is held "while a card is on the
 * table", and now that is true.
 */
export function letSleep() {
  wanted = false;
  const held = lock;
  lock = null;
  return held?.release().catch(() => {}) ?? Promise.resolve();
}

document.addEventListener('visibilitychange', () => {
  if (wanted && lock === null && document.visibilityState === 'visible') acquire();
});
