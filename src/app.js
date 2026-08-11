import { beginLogin, isLoggedIn, logout } from './auth.js';
import { connect } from './player.js';
import { loadPool, draw, resetSession } from './game.js';

const el = (id) => document.getElementById(id);
const screens = { signedOut: el('signed-out'), start: el('start'), table: el('table') };

const card = el('card');
const action = el('action');
const toggle = el('toggle');
const notice = el('notice');

let route = null;      // set once a playback route is connected
let pool = [];
let current = null;    // the song on the table, hidden until revealed
let phase = 'idle';    // idle | hidden | revealed | empty
let paused = false;

function show(screen) {
  for (const [name, node] of Object.entries(screens)) {
    node.classList.toggle('hidden', name !== screen);
  }
}

function say(message, isError = false) {
  notice.textContent = message ?? '';
  notice.classList.toggle('hidden', !message);
  notice.classList.toggle('error', Boolean(isError));
}

function setCard(song) {
  // Populate only at the moment of reveal; clear on the way out.
  el('card-artist').textContent = song?.artist ?? '';
  el('card-title').textContent = song?.title ?? '';
  el('card-year').textContent = song?.year ?? '';
  card.classList.toggle('revealed', Boolean(song));
}

function renderTable() {
  const labels = { idle: 'Draw', hidden: 'Reveal', revealed: 'Next', empty: 'Start over' };
  action.textContent = labels[phase];
  action.disabled = false;

  // Pause is only meaningful once something is playing.
  const hasTrack = phase === 'hidden' || phase === 'revealed';
  toggle.classList.toggle('hidden', !hasTrack);
  toggle.textContent = paused ? 'Resume' : 'Pause';
  toggle.disabled = false;

  card.classList.toggle('paused', paused);
}

async function onToggle() {
  toggle.disabled = true;
  say('');
  try {
    await (paused ? route.resume() : route.pause());
    paused = !paused;
  } catch (err) {
    say(err.message, true);
  }
  renderTable();
}

async function onAction() {
  action.disabled = true;
  say('');

  try {
    if (phase === 'hidden') {
      setCard(current);
      phase = 'revealed';
    } else if (phase === 'empty') {
      resetSession();
      setCard(null);
      phase = 'idle';
    } else {
      // Draw, or Next after a reveal.
      setCard(null);
      const song = draw(pool);
      if (!song) {
        phase = 'empty';
        say('Every song has been played. Start over for a fresh deck.');
      } else {
        current = song;
        await route.play(song.spotify_uri);
        paused = false;
        phase = 'hidden';
      }
    }
  } catch (err) {
    say(err.message, true);
  }

  renderTable();
}

function onBegin() {
  // Must stay synchronous. This runs inside the tap, and activateElement()
  // only counts as gesture-triggered if nothing has awaited first.
  try {
    route.activate();
  } catch {
    // Only the SDK route needs this, and it is not fatal if it is refused.
  }
  show('table');
  phase = 'idle';
  renderTable();
}

async function boot() {
  if (!isLoggedIn()) {
    show('signedOut');
    return;
  }

  show('start');

  // Connect and load the pool up front, so the Begin tap has nothing to await.
  const [connected, loaded] = await Promise.allSettled([
    connect({
      onFallback: (reason) => say(`Playing through the Spotify app on this device (${reason}).`),
    }),
    loadPool(),
  ]);

  if (loaded.status === 'rejected') {
    say(loaded.reason.message, true);
    return;
  }
  pool = loaded.value;

  if (connected.status === 'rejected') {
    say(connected.reason.message, true);
    return;
  }
  route = connected.value;

  const begin = el('begin');
  begin.textContent = 'Start';
  begin.disabled = false;
}

el('login').addEventListener('click', () => beginLogin().catch((err) => say(err.message, true)));
el('logout').addEventListener('click', () => { logout(); location.reload(); });
el('begin').addEventListener('click', onBegin);
action.addEventListener('click', onAction);
toggle.addEventListener('click', onToggle);

boot();
