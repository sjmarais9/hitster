// Tests for the one module every writer goes through:
//   node --test scripts/songs-file.test.mjs
//
// serialise() hand-builds JSON rather than using JSON.stringify on the whole
// document, so that a one-field edit is a one-line diff instead of a thousand.
// That is worth having, but hand-built JSON is JSON that can be malformed, and
// nothing until now checked that it parses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialise, writeSongs, readSongs } from './lib/songs-file.mjs';

const song = (over = {}) => ({
  artist: 'A', title: 'B', year: 1995, decade: '1990s', genres: ['rock'],
  familiarity: 'familiar', skew: 'even', spotify_uri: 'spotify:track:x',
  market_checked: 'ZA', canonicity: 50, ...over,
});

const doc = (over = {}) => ({
  meta: { batch: 'test', count: 1 },
  songs: [song()],
  ...over,
});

test('what it writes is valid JSON', () => {
  assert.deepEqual(JSON.parse(serialise(doc())), doc());
});

test('one song per line, so a one-field change is a one-line diff', () => {
  const three = doc({ songs: [song({ title: 'a' }), song({ title: 'b' }), song({ title: 'c' })] });
  const lines = serialise(three).split('\n').filter((l) => l.trim().startsWith('{ "artist"'));
  assert.equal(lines.length, 3);
});

test('titles that look like JSON survive', () => {
  // The reason it builds field by field instead of string-replacing a compact
  // dump: any of these would corrupt the latter.
  const nasty = [
    'Bohemian Rhapsody", "year": 1066, "x": "',
    'Comma, Separated',
    'Quote " inside',
    'Backslash \\ inside',
    'Newline \n inside',
    'Unicode: Beyoncé — Naïve 日本',
    '{ "nested": true }',
  ];

  const written = serialise(doc({ songs: nasty.map((title) => song({ title })) }));
  const back = JSON.parse(written);
  assert.deepEqual(back.songs.map((s) => s.title), nasty);
});

test('a document with no meta still parses', () => {
  // JSON.stringify({}, null, 2) is "{}", which the head-trimming regexes do not
  // match, so an empty meta used to be spliced in whole and produce "{\n{},".
  const bare = { songs: [song()] };
  const written = serialise(bare);
  assert.doesNotThrow(() => JSON.parse(written), `not valid JSON:\n${written}`);
  assert.deepEqual(JSON.parse(written).songs, bare.songs);
});

test('a document with no songs still parses', () => {
  const empty = { meta: { batch: 'none' }, songs: [] };
  assert.doesNotThrow(() => JSON.parse(serialise(empty)), serialise(empty));
  assert.deepEqual(JSON.parse(serialise(empty)).songs, []);
});

test('field order is preserved, so diffs stay readable', () => {
  const written = serialise(doc());
  const line = written.split('\n').find((l) => l.includes('"artist"'));
  assert.ok(line.indexOf('"artist"') < line.indexOf('"title"'));
  assert.ok(line.indexOf('"title"') < line.indexOf('"year"'));
});

test('a round trip through the disk changes nothing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'songs-file-'));
  const file = path.join(dir, 'songs.json');
  try {
    const original = doc({ songs: [song({ title: 'Round, "trip"' }), song({ artist: 'Sigur Rós' })] });
    await writeSongs(file, original);
    assert.deepEqual(await readSongs(file), original);

    // And writing what was read back out is byte-identical, or every scheduled
    // run would produce a diff whether or not anything changed.
    const once = await readFile(file, 'utf8');
    await writeSongs(file, await readSongs(file));
    assert.equal(await readFile(file, 'utf8'), once);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed write leaves the previous file intact', async () => {
  // The scenario this protects: the import checkpoints hundreds of times a
  // night, unattended. A plain overwrite that dies halfway leaves truncated
  // JSON that neither the app nor the next run can read.
  const dir = await mkdtemp(path.join(tmpdir(), 'songs-file-'));
  const file = path.join(dir, 'songs.json');
  try {
    await writeSongs(file, doc({ meta: { generation: 1 } }));
    const before = await readFile(file, 'utf8');

    // serialise() throws on this, partway through building the new contents.
    const poison = { meta: { generation: 2 }, songs: [{ get artist() { throw new Error('disk full'); } }] };
    await assert.rejects(() => writeSongs(file, poison), /disk full/);

    assert.equal(await readFile(file, 'utf8'), before, 'the old file was damaged');
    assert.deepEqual((await readSongs(file)).meta, { generation: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed write leaves no temp file behind', async () => {
  const { readdir } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'songs-file-'));
  try {
    const poison = { songs: [{ get artist() { throw new Error('nope'); } }] };
    await assert.rejects(() => writeSongs(path.join(dir, 'songs.json'), poison));
    assert.deepEqual(await readdir(dir), [], 'temp file left in place');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing file returns the fallback rather than throwing', async () => {
  assert.deepEqual(await readSongs('data/does-not-exist.json', { songs: [] }), { songs: [] });
});

test('a missing file with no fallback throws with the path in the message', async () => {
  await assert.rejects(() => readSongs('data/does-not-exist.json'), /does-not-exist/);
});
