import { beginLogin, isLoggedIn, logout } from './auth.js';
import { connect } from './player.js';
import { loadPool, draw, resetSession } from './game.js';
import { keepAwake } from './wakelock.js';

const el = (id) => document.getElementById(id);
const screens = { signedOut: el('signed-out'), start: el('start'), table: el('table') };

const card = el('card');
const reveal = el('reveal');
const mark = el('card-mark');
const action = el('action');
const toggle = el('toggle');
const replay = el('replay');
const notice = el('notice');

let route = null;      // set once a playback route is connected
let pool = [];
let current = null;    // the song on the table, hidden until revealed
let phase = 'ready';   // ready | revealed | empty
let playing = false;
let started = false;   // has the current song been played at all yet

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

function render() {
  action.textContent = phase === 'empty' ? 'Start over' : 'Next';
  action.disabled = false;

  // The card can only be turned over once the song has actually been heard.
  // Until then it stays a question mark and does not respond to a tap.
  const revealable = phase === 'ready' && started;
  card.classList.toggle('revealable', revealable);
  reveal.disabled = !revealable;
  mark.textContent = revealable ? 'Reveal' : '?';

  toggle.classList.toggle('playing', playing);
  toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  toggle.disabled = phase === 'empty';
  // Nothing to replay until the song has been started once.
  replay.disabled = phase === 'empty' || !started;

  // The record turns only while audio is actually running.
  card.classList.toggle('paused', !playing);
}

/** Puts the next card on the table, face down and silent. */
async function deal() {
  if (playing) {
    await route.pause().catch(() => {});
    playing = false;
  }

  setCard(null);
  const song = draw(pool);

  if (!song) {
    current = null;
    phase = 'empty';
    say('Every song has been played. Start over for a fresh deck.');
    return;
  }

  current = song;
  started = false;
  phase = 'ready';
}

function onReveal() {
  // Guarded here as well as by the disabled attribute, since this is the one
  // action in the game that cannot be undone.
  if (phase !== 'ready' || !started) return;

  setCard(current);
  phase = 'revealed';
  render();
}

async function onAction() {
  action.disabled = true;
  say('');

  try {
    if (phase === 'empty') resetSession();
    await deal();
  } catch (err) {
    say(err.message, true);
  }

  render();
}

async function onToggle() {
  toggle.disabled = true;
  say('');

  try {
    if (playing) {
      await route.pause();
      playing = false;
    } else if (started) {
      await route.resume();
      playing = true;
    } else {
      await route.play(current.spotify_uri);
      started = true;
      playing = true;
    }
  } catch (err) {
    say(err.message, true);
  }

  render();
}

async function onReplay() {
  replay.disabled = true;
  say('');

  try {
    await route.play(current.spotify_uri);
    playing = true;
  } catch (err) {
    say(err.message, true);
  }

  render();
}

function onBegin() {
  // Must stay synchronous. This runs inside the tap, and activateElement()
  // only counts as gesture-triggered if nothing has awaited first.
  try {
    route.activate();
  } catch {
    // Only the SDK route needs this, and it is not fatal if it is refused.
  }

  keepAwake();
  show('table');
  // A card is already on the table when the screen appears; the first tap of
  // Play starts it. Nothing plays on its own.
  deal().then(render);
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
reveal.addEventListener('click', onReveal);
action.addEventListener('click', onAction);
toggle.addEventListener('click', onToggle);
replay.addEventListener('click', onReplay);

boot();
