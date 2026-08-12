// End-to-end smoke test of the draw path: node --test scripts/smoke.test.mjs
//
// The unit tests exercise scoring.js and filters.js in isolation. Nothing until
// now exercised what the app actually does: load the real pool, apply the real
// filters, and draw through game.js with session memory in play.
//
// That gap matters because the draw path has been rewritten twice - once for
// weighted sampling, once for the genre mixer - and the only proof it still
// works has been that the parts pass their own tests.
//
// game.js expects a browser, so fetch and sessionStorage are stubbed. Nothing
// else is faked: this runs against the real data files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const poolFile = path.join(ROOT, 'data', 'songs.json');
const realPool = JSON.parse(await readFile(poolFile, 'utf8')).songs;

// --- the browser bits game.js needs ------------------------------------------

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.localStorage = globalThis.sessionStorage;
globalThis.location = { pathname: '/', origin: 'http://localhost' };
globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(await readFile(poolFile, 'utf8')),
});

const { loadPool, draw, resetSession } = await import('../src/game.js');
const filters = await import('../src/filters.js');

test('the real pool loads and every song is playable', async () => {
  const pool = await loadPool();
  assert.ok(pool.length > 0, 'pool should not be empty');
  assert.equal(pool.length, realPool.filter((s) => s.spotify_uri).length);
  assert.ok(pool.every((s) => s.spotify_uri), 'loadPool must drop unresolved songs');
});

test('a full session draws every song exactly once, then stops', async () => {
  store.clear();
  const pool = await loadPool();
  const deck = filters.apply(pool, filters.DEFAULTS);

  const seen = new Set();
  for (let i = 0; i < deck.length; i++) {
    const song = draw(deck, filters.DEFAULTS);
    assert.ok(song, `draw ${i + 1} of ${deck.length} returned nothing`);
    assert.ok(!seen.has(song.spotify_uri), `${song.title} was drawn twice`);
    seen.add(song.spotify_uri);
  }

  assert.equal(draw(deck, filters.DEFAULTS), null, 'an exhausted deck must return null');
  resetSession();
  assert.ok(draw(deck, filters.DEFAULTS), 'starting over should deal again');
});

test('every filter combination still leaves a drawable deck', async () => {
  const pool = await loadPool();

  const combinations = [
    { label: 'defaults', f: filters.DEFAULTS },
    { label: 'casual', f: { ...filters.DEFAULTS, level: 'casual' } },
    { label: 'adults only', f: { ...filters.DEFAULTS, crowd: 0 } },
    { label: 'kids only', f: { ...filters.DEFAULTS, crowd: 1 } },
    { label: 'one decade', f: { ...filters.DEFAULTS, decades: ['1990s'] } },
    {
      label: 'rock boosted',
      f: { ...filters.DEFAULTS, genreLevels: { ...filters.DEFAULTS.genreLevels, rock: 2 } },
    },
    {
      label: 'casual + kids + rock muted',
      f: {
        ...filters.DEFAULTS, level: 'casual', crowd: 1,
        genreLevels: { ...filters.DEFAULTS.genreLevels, rock: 0 },
      },
    },
  ];

  for (const { label, f } of combinations) {
    store.clear();
    const deck = filters.apply(pool, f);
    assert.ok(deck.length > 0, `${label}: filters left an empty deck`);
    const song = draw(deck, f);
    assert.ok(song, `${label}: could not draw`);
    assert.ok(song.spotify_uri, `${label}: drew a song with no URI`);
  }
});

test('a saved selection from before the mixer does not break the draw', async () => {
  store.clear();
  const pool = await loadPool();
  // The shape localStorage would hold from the chip-based version.
  const legacy = { level: 'confident', crowd: 'everyone', decades: filters.DECADES, genres: ['rock'] };
  const merged = { ...filters.DEFAULTS, ...legacy };

  const deck = filters.apply(pool, merged);
  assert.ok(deck.length > 0, 'legacy settings emptied the deck');
  assert.ok(draw(deck, merged), 'legacy settings broke the draw');
});

test('describe never throws on any reachable settings shape', () => {
  const shapes = [
    filters.DEFAULTS,
    { ...filters.DEFAULTS, crowd: 0 },
    { ...filters.DEFAULTS, genreLevels: {} },
    { ...filters.DEFAULTS, genreLevels: undefined },
    { ...filters.DEFAULTS, decades: ['1990s'] },
  ];
  for (const shape of shapes) {
    assert.equal(typeof filters.describe(shape), 'string');
  }
});
