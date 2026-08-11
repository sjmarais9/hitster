// Zero-dependency tests for the matcher: node --test scripts/
//
// These cases are the real shapes Spotify returns — remaster suffixes, feat.
// in the title, ampersands, "The" on band names. The matcher deciding wrongly
// here is the failure that puts a wrong track in the pool, so it is worth
// pinning down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, grade, pickBest } from './lib/match.mjs';

const track = (name, artists, extra = {}) => ({
  name,
  uri: 'spotify:track:test',
  artists: artists.map((a) => ({ name: a })),
  album: { name: 'Album', release_date: '2011-01-01' },
  ...extra,
});

test('normalise strips the decorations Spotify adds', () => {
  assert.equal(normalise('Smells Like Teen Spirit - Remastered 2021'), 'smells like teen spirit');
  assert.equal(normalise('Uptown Funk (feat. Bruno Mars)'), 'uptown funk');
  assert.equal(normalise('HUMBLE.'), 'humble');
  assert.equal(normalise("Nuthin' but a 'G' Thang"), 'nuthin but a g thang');
  assert.equal(normalise('The Beach Boys'), 'beach boys');
  assert.equal(normalise('Johnny Clegg & Savuka'), 'johnny clegg and savuka');
  assert.equal(normalise('Beyoncé'), 'beyonce');
});

test('exact title and artist is confident', () => {
  const song = { artist: 'Elvis Presley', title: 'Jailhouse Rock', year: 1957 };
  assert.equal(grade(song, track('Jailhouse Rock', ['Elvis Presley'])).verdict, 'confident');
});

test('remaster suffixes still match confidently', () => {
  const song = { artist: 'Nirvana', title: 'Smells Like Teen Spirit', year: 1991 };
  const got = track('Smells Like Teen Spirit - Remastered 2021', ['Nirvana']);
  assert.equal(grade(song, got).verdict, 'confident');
});

test('a featured artist in the title does not block the match', () => {
  const song = { artist: 'Mark Ronson', title: 'Uptown Funk', year: 2014 };
  const got = track('Uptown Funk (feat. Bruno Mars)', ['Mark Ronson', 'Bruno Mars']);
  assert.equal(grade(song, got).verdict, 'confident');
});

test('ampersand and "The" differences do not block the match', () => {
  const clegg = { artist: 'Johnny Clegg and Savuka', title: 'Scatterlings of Africa', year: 1987 };
  assert.equal(grade(clegg, track('Scatterlings of Africa', ['Johnny Clegg & Savuka'])).verdict, 'confident');

  const boys = { artist: 'The Beach Boys', title: 'Good Vibrations', year: 1966 };
  assert.equal(grade(boys, track('Good Vibrations', ['Beach Boys'])).verdict, 'confident');
});

test('a cover by a different artist is rejected', () => {
  const song = { artist: 'Toto', title: 'Africa', year: 1982 };
  assert.equal(grade(song, track('Africa', ['Weezer'])).verdict, 'reject');
});

test('a different song with a similar title is rejected', () => {
  const song = { artist: 'Toto', title: 'Africa', year: 1982 };
  assert.equal(grade(song, track('Africa Unite', ['Bob Marley & The Wailers'])).verdict, 'reject');
});

test('unplayable in market is rejected even on a perfect name match', () => {
  const song = { artist: 'Toto', title: 'Africa', year: 1982 };
  const got = track('Africa', ['Toto'], { is_playable: false });
  assert.equal(grade(song, got).verdict, 'reject');
});

test('a missing is_playable field is not treated as unavailable', () => {
  const song = { artist: 'Toto', title: 'Africa', year: 1982 };
  assert.equal(grade(song, track('Africa', ['Toto'])).verdict, 'confident');
});

test('pickBest prefers a confident match over an earlier probable one', () => {
  const song = { artist: 'Toto', title: 'Africa', year: 1982 };
  const candidates = [
    track('Africa (Live)', ['Toto Tribute Band']),
    track('Africa', ['Toto']),
  ];
  const best = pickBest(song, candidates);
  assert.equal(best.verdict, 'confident');
  assert.deepEqual(best.track.artists.map((a) => a.name), ['Toto']);
});

test('pickBest on no results is null', () => {
  assert.equal(pickBest({ artist: 'A', title: 'B', year: 2000 }, []), null);
});
