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

document.addEventListener('visibilitychange', () => {
  if (wanted && lock === null && document.visibilityState === 'visible') acquire();
});
