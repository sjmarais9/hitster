import { beginLogin, isLoggedIn, logout } from './auth.js';
import { connect } from './player.js';
import { loadPool, draw, resetSession } from './game.js';
import { keepAwake } from './wakelock.js';
import { projectedShares } from './scoring.js';
import * as filters from './filters.js';

const el = (id) => document.getElementById(id);
const screens = {
  signedOut: el('signed-out'),
  start: el('start'),
  filters: el('filters'),
  table: el('table'),
};

const card = el('card');
const reveal = el('reveal');
const mark = el('card-mark');
const action = el('action');
const toggle = el('toggle');
const replay = el('replay');
const notice = el('notice');

let route = null;      // set once a playback route is connected
let pool = [];         // everything with a verified URI
let deck = [];         // what the current filters leave to draw from
let chosen = filters.load();
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

/** Rebuilds the filtered deck and updates everything that reports on it. */
function refreshDeck() {
  deck = filters.apply(pool, chosen);
  el('deck-count').textContent = deck.length === 0
    ? 'No songs match these filters.'
    : `${deck.length} song${deck.length === 1 ? '' : 's'} in the deck`;
  el('deck-summary').textContent = filters.describe(chosen);
  // Nothing to draw from is not a game worth starting.
  el('begin').disabled = route === null || deck.length === 0;
  // Every share is a share *of the deck*, so they all move when it does.
  renderShares();
}

/**
 * A toggle chip. `pressed` drives aria-pressed, which is also what the
 * stylesheet keys off, so the visual and accessible states cannot diverge.
 */
function chip({ label, hint, pressed, onToggle }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.setAttribute('aria-pressed', String(pressed));

  const name = document.createElement('span');
  name.textContent = label;
  button.append(name);

  if (hint) {
    const detail = document.createElement('span');
    detail.className = 'chip-hint';
    detail.textContent = hint;
    button.append(detail);
  }

  button.addEventListener('click', () => {
    onToggle();
    filters.save(chosen);
    buildChips();
    refreshDeck();
  });

  return button;
}

/** One of a set: picking a new one replaces the current choice. */
function radioChips(container, options, selected, onPick) {
  container.replaceChildren(...Object.entries(options).map(([key, option]) =>
    chip({
      label: option.label,
      hint: option.hint,
      pressed: selected === key,
      onToggle: () => onPick(key),
    })));
}

function buildChips() {
  radioChips(el('level-options'), filters.LEVELS, chosen.level, (key) => { chosen.level = key; });

  const slider = el('crowd-slider');
  slider.value = String(chosen.crowd ?? 0.5);
  el('crowd-label').textContent = filters.CROWD.labelFor(chosen.crowd ?? 0.5);

  buildDecadeMixer();
  buildGenreMixer();
}

/**
 * One fader for one group. Zero is Off; every other position only changes how
 * often that group comes up.
 *
 * Returns the element the value is written into, so a caller that wants to show
 * something livelier than the fader's own position can keep hold of it.
 */
function fader({ id, label, level, onInput }) {
  const row = document.createElement('div');
  row.className = 'mixer-row';

  const name = document.createElement('label');
  name.className = 'mixer-label';
  name.textContent = label;
  name.htmlFor = `fader-${id}`;

  const value = document.createElement('span');
  value.className = 'mixer-value';

  const input = document.createElement('input');
  input.type = 'range';
  input.id = `fader-${id}`;
  input.className = 'slider';
  input.min = '0';
  input.max = '2';
  input.step = '0.1';
  input.value = String(level);

  input.addEventListener('input', () => onInput(Number(input.value)));

  row.append(name, value, input);
  return { row, value };
}

/** Where each decade's live share readout is written. */
let shareLabels = new Map();

function buildDecadeMixer() {
  shareLabels = new Map();

  el('decade-mixer').replaceChildren(...filters.DECADES.map((decade) => {
    const { row, value } = fader({
      id: decade,
      label: decade,
      level: chosen.decadeLevels?.[decade] ?? 1,
      onInput: (level) => {
        chosen.decadeLevels = { ...chosen.decadeLevels, [decade]: level };
        filters.save(chosen);
        // Off is the one fader position that removes songs outright, so the
        // deck count has to follow it. refreshDeck redraws the shares too.
        refreshDeck();
      },
    });
    shareLabels.set(decade, value);
    return row;
  }));
}

function buildGenreMixer() {
  el('genre-mixer').replaceChildren(...Object.entries(filters.GENRE_FAMILIES).map(([key, family]) => {
    const { row, value } = fader({
      id: key,
      label: family.label,
      level: chosen.genreLevels?.[key] ?? 1,
      onInput: (level) => {
        chosen.genreLevels = { ...chosen.genreLevels, [key]: level };
        render();
        filters.save(chosen);
        // No refreshDeck: a muted genre stays in the deck, weighted to nothing,
        // so the mixer can be moved mid-session without the unplayed set
        // shifting under the player. But it does move the decades.
        renderShares();
      },
    });

    const render = () => {
      const v = chosen.genreLevels?.[key] ?? 1;
      value.textContent = v === 0 ? 'Off' : v === 1 ? '—' : `${v.toFixed(1)}×`;
      value.classList.toggle('is-off', v === 0);
    };
    render();

    return row;
  }));
}

/**
 * The live mix readout.
 *
 * A fader position is a multiplier, and "1.4×" does not answer the question
 * being asked, which is whether the nineties are back up to a quarter of the
 * night. Showing the resulting share instead turns guesswork into aiming - and
 * it has to be recomputed when the genre mixer moves too, because weighting up
 * rock drags the decades along with it.
 */
function renderShares() {
  const shares = projectedShares(deck, chosen, (song) => song.decade);

  for (const [decade, node] of shareLabels) {
    const off = (chosen.decadeLevels?.[decade] ?? 1) <= 0;
    node.textContent = off ? 'Off' : `${Math.round((shares[decade] ?? 0) * 100)}%`;
    node.classList.toggle('is-off', off);
  }
}

/** Puts the next card on the table, face down and silent. */
async function deal() {
  if (playing) {
    await route.pause().catch(() => {});
    playing = false;
  }

  setCard(null);
  // The filters both narrow the deck and shape the odds within it.
  const song = draw(deck, chosen);

  if (!song) {
    current = null;
    phase = 'empty';
    say('Every song in this deck has been played. Start over, or widen the filters.');
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

  el('begin').textContent = 'Start';
  buildChips();
  refreshDeck();
}

el('login').addEventListener('click', () => beginLogin().catch((err) => say(err.message, true)));
el('logout').addEventListener('click', () => { logout(); location.reload(); });
el('begin').addEventListener('click', onBegin);
el('crowd-slider').addEventListener('input', (event) => {
  chosen.crowd = Number(event.target.value);
  el('crowd-label').textContent = filters.CROWD.labelFor(chosen.crowd);
  filters.save(chosen);
  // No refreshDeck: the slider changes the odds, not which songs are eligible.
  // It does move the decades, though - the children's songs are not spread
  // evenly across the eras.
  renderShares();
});
el('open-filters').addEventListener('click', () => show('filters'));
el('close-filters').addEventListener('click', () => show('start'));
reveal.addEventListener('click', onReveal);
action.addEventListener('click', onAction);
toggle.addEventListener('click', onToggle);
replay.addEventListener('click', onReplay);

boot();
