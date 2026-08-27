import { beginLogin, isLoggedIn, logout } from './auth.js?v=af25f86d';
import { connect } from './player.js?v=af25f86d';
import { loadPool, draw, resetSession, playedCount } from './game.js?v=af25f86d';
import { keepAwake, letSleep } from './wakelock.js?v=af25f86d';
import { projectedShares } from './scoring.js?v=af25f86d';
import * as filters from './filters.js?v=af25f86d';

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
  // Neither the table nor the menu should ever scroll: the table because a card
  // dragged half off the screen mid-round is a spoiler as much as an annoyance,
  // the menu because it is four items and a title. The deck is the opposite -
  // it is a long page and must scroll. A short-viewport media query lets the
  // lock go on screens too small for the content, so nothing is ever stranded.
  document.body.classList.toggle('locked', screen === 'table' || screen === 'start');
  if (screen === 'start') refreshStart();
}

// --- moving between screens --------------------------------------------------
//
// Each screen is a history entry, so the phone's back button does what it looks
// like it does. Before this there was no way out of a game at all: back left
// the app, and coming back landed on the login screen mid-round.
//
// The two in-app back controls call history.back() rather than go() so the
// stack unwinds instead of growing a new entry every time the deck is opened.

function go(screen) {
  if (history.state?.screen === screen) return;
  history.pushState({ screen }, '');
  show(screen);
}

/** Stops the music on the way out of a game. The session itself is kept. */
async function leaveTable() {
  // Unconditional: the lock was taken on the first Start and never given back,
  // so the screen was held awake on the menu and the deck screen too.
  letSleep();

  // `busy` as well as `playing`, because the window they differ in is the one
  // that matters. During an in-flight play, `playing` is still false, so this
  // used to walk away without pausing - the song carried on over the menu while
  // the app believed nothing was playing, and the next card was then dealt on
  // top of it.
  if (!playing && !busy) return;
  playing = false;
  await route?.pause().catch(() => {});
  render();
}

window.addEventListener('popstate', (event) => {
  const screen = event.state?.screen ?? (isLoggedIn() ? 'start' : 'signedOut');
  if (screen !== 'table') leaveTable();
  show(screen);
});

/** The start screen reports whether there is a game to come back to. */
function refreshStart() {
  const played = playedCount();
  el('begin').textContent = route === null ? 'Preparing…'
    : played > 0 ? 'Resume game' : 'Start';
  el('new-game').classList.toggle('hidden', played === 0);
}

function say(message, isError = false) {
  notice.textContent = message ?? '';
  notice.classList.toggle('hidden', !message);
  notice.classList.toggle('error', Boolean(isError));

  // Reserve the room it occupies rather than floating over the layout.
  //
  // Fixing the notice to the bottom of the viewport made it visible everywhere,
  // and then parked it on top of the transport row on the table screen and the
  // Log out link on the menu - so a boot-time failure covered the only way out
  // of the screen it was reporting. The sections are sized to the viewport, so
  // the only honest fix is to give them less viewport when a notice is up.
  const room = message ? Math.ceil(notice.getBoundingClientRect().height) + 12 : 0;
  document.documentElement.style.setProperty('--notice', `${room}px`);
}

function setCard(song) {
  // Populate only at the moment of reveal; clear on the way out.
  el('card-artist').textContent = song?.artist ?? '';
  el('card-year').textContent = song?.year ?? '';

  // The pool holds titles up to 57 characters. At full size those need four
  // lines and lose the last one to the clamp, so the long tail steps down a
  // size or two. Almost every title is short enough to keep the full size.
  const title = el('card-title');
  const length = (song?.title ?? '').length;
  title.textContent = song?.title ?? '';
  title.classList.toggle('long', length > 22 && length <= 34);
  title.classList.toggle('longer', length > 34);

  // Only about 70% of the pool carries one, and an empty line under the year
  // reads as something failing to load rather than something absent.
  const album = el('card-album');
  album.textContent = song?.album ?? '';
  album.classList.toggle('hidden', !song?.album);

  card.classList.toggle('revealed', Boolean(song));
}

function render() {
  // Icon-only now, so the meaning has to reach a screen reader some other way -
  // and the icon itself swaps to a restart once there is nothing left to skip to.
  const spent = phase === 'empty';
  action.classList.toggle('exhausted', spent);
  action.setAttribute('aria-label', spent ? 'Start over' : 'Next song');
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

/**
 * Persists a settings change and repaints everything that reports on it.
 *
 * The summary under the Deck button used to be written only by refreshDeck,
 * which only the decade faders call - so changing a genre, the level or the
 * crowd left the start screen describing settings that were no longer in force
 * until something happened to reload the page. Every control routes through
 * here now, and the summary is written on the way past.
 */
function settingsChanged({ deckChanged = false } = {}) {
  filters.save(chosen);
  el('deck-summary').textContent = filters.describe(chosen);
  // Only a decade at Off changes which songs are eligible; everything else
  // just moves the odds, so there is nothing to rebuild.
  if (deckChanged) refreshDeck();
  else renderShares();
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

// --- the level knob ----------------------------------------------------------
//
// A volume knob, because that is what this control is: how much of the
// catalogue is being let through. Casual is barely open, Encyclopaedic is wide
// open, and the exponent it sets runs the same way - k=4 down to k=0.
//
// The stops are spread across a 270-degree sweep, the way an amplifier's are,
// and their count comes from LEVELS - nothing here assumes how many there are.

const SWEEP = 135;

/** Degrees clockwise from straight up, clamped to the sweep. */
function angleAt(node, x, y) {
  const box = node.getBoundingClientRect();
  const deg = Math.atan2(x - (box.left + box.width / 2),
    (box.top + box.height / 2) - y) * (180 / Math.PI);
  return Math.max(-SWEEP, Math.min(SWEEP, deg));
}

function buildKnob() {
  const keys = Object.keys(filters.LEVELS);
  const angleOf = (i) => -SWEEP + (i * SWEEP * 2) / (keys.length - 1);
  let index = Math.max(0, keys.indexOf(chosen.level));

  const dial = document.createElement('div');
  dial.className = 'knob-dial';

  // Tick marks behind the knob, one per stop, so the sweep is legible when the
  // pointer is between them mid-drag.
  for (const i of keys.keys()) {
    const tick = document.createElement('span');
    tick.className = 'knob-tick';
    tick.style.setProperty('--angle', `${angleOf(i)}deg`);
    dial.append(tick);
  }

  const knob = document.createElement('button');
  knob.type = 'button';
  knob.className = 'knob';
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-valuemin', '0');
  knob.setAttribute('aria-valuemax', String(keys.length - 1));
  knob.setAttribute('aria-label', 'How well does this crowd know their music');

  const pointer = document.createElement('span');
  pointer.className = 'knob-pointer';
  knob.append(pointer);
  dial.append(knob);

  // Each label sits at the angle its setting turns the knob to, the way the
  // scale is printed around an amplifier's dial. CSS does the geometry from
  // --angle; nothing here needs to know where they land.
  const stops = keys.map((key, i) => {
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'knob-stop';
    stop.style.setProperty('--angle', `${angleOf(i)}deg`);
    stop.textContent = filters.LEVELS[key].label;
    // Clicking a label is the primary way in. The knob turns to follow.
    stop.addEventListener('click', () => select(i));
    dial.append(stop);
    return stop;
  });

  const hint = document.createElement('p');
  hint.className = 'knob-hint';

  function paint() {
    knob.style.setProperty('--angle', `${angleOf(index)}deg`);
    knob.setAttribute('aria-valuenow', String(index));
    knob.setAttribute('aria-valuetext', filters.LEVELS[keys[index]].label);
    stops.forEach((stop, i) => stop.setAttribute('aria-pressed', String(i === index)));
    hint.textContent = filters.LEVELS[keys[index]].hint;
  }

  function select(next) {
    const clamped = Math.max(0, Math.min(keys.length - 1, next));
    if (clamped === index) return;
    index = clamped;
    chosen.level = keys[index];
    paint();
    // The level changes the odds, not which songs are eligible. It does move
    // the decades, since the eras are not equally well known.
    settingsChanged();
  }

  // Drag to turn. Snapping to the nearest stop rather than tracking freely
  // keeps it honest - there are only three settings, and a knob that came to
  // rest between them would be lying about what it had selected.
  let turning = false;
  let moved = false;
  let from = null;

  knob.addEventListener('pointerdown', (event) => {
    knob.setPointerCapture(event.pointerId);
    turning = true;
    moved = false;
    from = { x: event.clientX, y: event.clientY };
    // The easing that makes a click feel like a knob turning makes a drag feel
    // like it is lagging behind the finger.
    knob.classList.add('turning');
  });

  knob.addEventListener('pointermove', (event) => {
    if (!turning) return;
    // A few pixels of slop, so a tap that wobbles is still a tap.
    if (!moved && Math.hypot(event.clientX - from.x, event.clientY - from.y) < 5) return;
    moved = true;
    const angle = angleAt(knob, event.clientX, event.clientY);
    select(Math.round(((angle + SWEEP) / (SWEEP * 2)) * (keys.length - 1)));
  });

  const release = () => {
    turning = false;
    knob.classList.remove('turning');
  };
  knob.addEventListener('pointercancel', release);
  knob.addEventListener('pointerup', release);

  // Tap rather than turn: step up, wrapping round from full volume so the knob
  // is never a dead control. The wrap target is always in range, so select()'s
  // clamp leaves it alone. Handled on click rather than pointerup so that
  // Enter and Space reach it too - the element is still a button underneath.
  knob.addEventListener('click', () => {
    if (!moved) select((index + 1) % keys.length);
    moved = false;
  });

  knob.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    select(index + step);
  });

  paint();
  el('level-knob').replaceChildren(dial, hint);
}

function buildChips() {
  buildKnob();

  const slider = el('crowd-slider');
  slider.value = String(chosen.crowd ?? 0.5);
  el('crowd-label').textContent = filters.CROWD.labelFor(chosen.crowd ?? 0.5);

  buildDecadeMixer();
  buildGenreMixer();
}

/**
 * Makes a range input respond only to its thumb.
 *
 * A native slider jumps to wherever the track is touched, which on a page of
 * seventeen faders means scrolling past them edits them.
 *
 * The first attempt at this called preventDefault() on pointerdown and did not
 * work: the range input sets its value from its own internal handling, which
 * that does not reach. So the native pointer behaviour is switched off outright
 * — `pointer-events: none` in CSS — and replaced. A wrapper takes the pointer
 * events, decides whether the press landed on the thumb, and if it did, drives
 * `value` and fires `input` itself.
 *
 * The element stays a real `<input type="range">`, so it keeps its keyboard
 * behaviour, its focus ring and its ARIA for nothing.
 */
function thumbOnly(input) {
  const shell = document.createElement('span');
  shell.className = 'slider-shell';
  input.replaceWith(shell);
  shell.append(input);

  const geometry = () => {
    const box = input.getBoundingClientRect();
    // Read the thumb width from CSS rather than repeating it here, so the two
    // cannot drift apart. In px, because getComputedStyle does not resolve rem
    // for custom properties.
    const thumb = parseFloat(getComputedStyle(input).getPropertyValue('--thumb')) || 36;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 0;
    return { box, thumb, min, max, travel: box.width - thumb };
  };

  /** Is this press on the thumb, rather than somewhere along the track? */
  function onThumb(clientX) {
    const { box, thumb, min, max, travel } = geometry();
    const position = max === min ? 0 : (Number(input.value) - min) / (max - min);
    const centre = box.left + thumb / 2 + position * travel;
    // Half the cap, plus a generous margin. The cap is drawn narrow because
    // that is what a fader looks like; the thing you have to hit should not
    // also be narrow. Roughly a 46px target around a 22px cap.
    return Math.abs(clientX - centre) <= thumb / 2 + 12;
  }

  function valueAt(clientX) {
    const { box, thumb, min, max, travel } = geometry();
    const fraction = travel <= 0 ? 0 : (clientX - box.left - thumb / 2) / travel;
    const raw = min + Math.max(0, Math.min(1, fraction)) * (max - min);
    const step = Number(input.step) || 1;
    // Rounded to the step, then to a sane number of decimals: 0.30000000000004
    // would be a real value that never equals the 0.3 anything else compares to.
    return Number((Math.round(raw / step) * step).toFixed(4));
  }

  function set(value) {
    if (Number(input.value) === value) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  let dragging = false;

  shell.addEventListener('pointerdown', (event) => {
    if (!onThumb(event.clientX)) return;   // a tap on the track does nothing
    dragging = true;
    shell.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  shell.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.preventDefault();
    set(valueAt(event.clientX));
  });

  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    try { shell.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
  };
  shell.addEventListener('pointerup', stop);
  shell.addEventListener('pointercancel', stop);
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

  // Appended first: thumbOnly wraps the input in place, which needs a parent.
  row.append(name, value, input);
  thumbOnly(input);

  return { row, value };
}

/** Where each live share readout is written, per mixer. */
let decadeLabels = new Map();
let genreLabels = new Map();

function buildDecadeMixer() {
  decadeLabels = new Map();

  el('decade-mixer').replaceChildren(...filters.DECADES.map((decade) => {
    const { row, value } = fader({
      id: decade,
      label: decade,
      level: chosen.decadeLevels?.[decade] ?? 1,
      onInput: (level) => {
        chosen.decadeLevels = { ...chosen.decadeLevels, [decade]: level };
        // Off is the one fader position that removes songs outright, so the
        // deck itself has to be rebuilt behind this one.
        settingsChanged({ deckChanged: true });
      },
    });
    decadeLabels.set(decade, value);
    return row;
  }));
}

function buildGenreMixer() {
  genreLabels = new Map();

  el('genre-mixer').replaceChildren(...Object.entries(filters.GENRE_FAMILIES).map(([key, family]) => {
    const { row, value } = fader({
      id: key,
      label: family.label,
      level: chosen.genreLevels?.[key] ?? 1,
      onInput: (level) => {
        chosen.genreLevels = { ...chosen.genreLevels, [key]: level };
        // A muted genre stays in the deck, weighted to nothing, so the mixer
        // can be moved mid-session without the unplayed set shifting under the
        // player.
        settingsChanged();
      },
    });

    genreLabels.set(key, value);
    return row;
  }));
}

/**
 * The live mix readout, for both mixers.
 *
 * A fader position is a multiplier, and "1.4×" does not answer the question
 * being asked, which is whether the nineties are back up to a quarter of the
 * night. The resulting share does, and it turns guesswork into aiming.
 *
 * Both are recomputed together on every change, because the two mixers are not
 * independent of each other or of the crowd slider: rock is not spread evenly
 * across the decades, so weighting it up moves the eras, and weighting up the
 * 1990s moves the genres straight back.
 */
function renderShares() {
  const paint = (labels, shares, levels) => {
    for (const [key, node] of labels) {
      const off = (levels?.[key] ?? 1) <= 0;
      node.textContent = off ? 'Off' : `${Math.round((shares[key] ?? 0) * 100)}%`;
      node.classList.toggle('is-off', off);
    }
  };

  paint(decadeLabels, projectedShares(deck, chosen, (song) => song.decade), chosen.decadeLevels);
  paint(genreLabels, projectedShares(deck, chosen, filters.familyOf), chosen.genreLevels);
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
    // Covers both ways of running out: every song played, or every song that
    // remains excluded by where the controls are set. The player cannot tell
    // those apart and does not need to - the remedy is the same either way, and
    // naming a specific control would be wrong half the time.
    say('Nothing left to draw at these settings. Start over, or open the deck and widen it.');
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

/**
 * One transport action at a time.
 *
 * Each handler used to disable only its own button, so a tap on Next while Play
 * was still in flight ran both. `playing` was still false, so deal()'s pause
 * guard missed, song B was drawn, and then the pending play(A) resolved and set
 * started = true - leaving a revealable card showing B while A was audible.
 * Reveal then gave the wrong year, which is the one thing this app must never
 * do. The window is a network round trip: hundreds of milliseconds, longer on a
 * bad connection, and a second tap in that window is not an unusual thing to do.
 *
 * Guarding the shared state rather than the three buttons separately is what
 * makes it safe; disabling all three is only so it looks unavailable too.
 */
let busy = false;

async function transport(work) {
  if (busy) return;
  busy = true;
  action.disabled = true;
  toggle.disabled = true;
  replay.disabled = true;
  say('');

  try {
    await work();
  } catch (err) {
    say(err.message, true);
  } finally {
    busy = false;
    render();
  }
}

const onAction = () => transport(async () => {
  if (phase === 'empty') resetSession();
  await deal();
});

const onToggle = () => transport(async () => {
  if (playing) {
    await route.pause();
    playing = false;
  } else if (started) {
    await route.resume();
    playing = true;
  } else {
    // Captured before the await: if anything did manage to change the card
    // underneath us, these flags must not be applied to a different song.
    const song = current;
    await route.play(song.spotify_uri);
    if (song !== current) return;
    started = true;
    playing = true;
  }
});

const onReplay = () => transport(async () => {
  const song = current;
  await route.play(song.spotify_uri);
  if (song !== current) return;
  playing = true;
});

function onBegin() {
  // Must stay synchronous. This runs inside the tap, and activateElement()
  // only counts as gesture-triggered if nothing has awaited first.
  try {
    route.activate();
  } catch {
    // Only the SDK route needs this, and it is not fatal if it is refused.
  }

  keepAwake();
  go('table');
  // Resuming keeps the card that is already on the table. Only a fresh game
  // deals, and it deals before the screen is touched so nothing plays on its
  // own - the first tap of Play starts it.
  //
  // Through transport(), not bare: this is the only deal() outside it, and
  // deal() can fail - a pool that loaded but has nothing eligible, for one.
  // Unguarded, that rejection went nowhere and left a blank table with no
  // message and stale buttons.
  if (current === null) transport(deal);
  else render();
}

async function boot() {
  if (!isLoggedIn()) {
    show('signedOut');
    history.replaceState({ screen: 'signedOut' }, '');
    return;
  }

  show('start');
  history.replaceState({ screen: 'start' }, '');

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
    // A stored refresh token that Spotify has since rejected leaves us on a
    // start screen with a disabled button and no way back to the login. Its
    // own handler has already cleared it, so asking again is the whole fix.
    if (!isLoggedIn()) {
      show('signedOut');
      history.replaceState({ screen: 'signedOut' }, '');
    }
    return;
  }
  route = connected.value;

  buildChips();
  refreshDeck();
  refreshStart();
}

el('login').addEventListener('click', () => beginLogin().catch((err) => say(err.message, true)));
el('logout').addEventListener('click', () => { logout(); location.reload(); });
el('begin').addEventListener('click', onBegin);
el('crowd-slider').addEventListener('input', (event) => {
  chosen.crowd = Number(event.target.value);
  el('crowd-label').textContent = filters.CROWD.labelFor(chosen.crowd);
  // The slider changes the odds, not which songs are eligible. It does move the
  // decades, though - the children's songs are not spread evenly across the eras.
  settingsChanged();
});
thumbOnly(el('crowd-slider'));

el('open-filters').addEventListener('click', () => go('filters'));
// back() rather than go('start'), so opening and closing the deck repeatedly
// unwinds the history stack instead of piling entries onto it.
el('close-filters').addEventListener('click', () => history.back());
el('leave').addEventListener('click', () => history.back());
el('new-game').addEventListener('click', () => {
  resetSession();
  current = null;
  phase = 'ready';
  started = false;
  refreshStart();
  say('');
});
reveal.addEventListener('click', onReveal);
action.addEventListener('click', onAction);
toggle.addEventListener('click', onToggle);
replay.addEventListener('click', onReplay);

boot();
