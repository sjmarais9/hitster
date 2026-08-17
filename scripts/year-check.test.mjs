// The rule that decides whether a year gets corrected.
//
// Every case below is a real song from 16 August, because a rule about
// disagreeing catalogues invented from imagination tests the imagination. The
// nine suspects are the whole evidence base this rule was fitted to, and six of
// them were genuinely wrong.
//
// The property that matters is not how many errors it catches. It is that it
// never invents one: a false correction writes a wrong year into the pool with
// nobody watching, while a missed one stays on a list a person reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyYear, MARGIN, TOLERANCE } from './lib/year-check.mjs';

// artist, ours, spotify, musicbrainz, what was actually true
const NINE = [
  ['Taylor Swift - Cruel Summer', 2023, 2019, 2019, 'wrong'],
  ['Bush - Machinehead', 1996, 1994, 1994, 'wrong'],
  ['Frankie Knuckles - Your Love', 2003, 1987, 1987, 'wrong'],
  ['Maneskin - Beggin', 2023, 2017, 2017, 'wrong'],
  ['Mayhem - Freezing Moon', 1996, 1994, 1995, 'wrong'],
  ['Ramones - I Wanna Be Sedated', 1988, 1978, 1991, 'wrong'],
  ['Dinosaur Jr. - Just Like Heaven', 1989, 1987, 1989, 'right'],
  ['Neil Sedaka - Breaking Up Is Hard to Do', 1962, 1960, 1993, 'right'],
  ['Luther Ingram - If Loving You Is Wrong', 1972, 1967, 1972, 'right'],
];

test('it never confirms a correction to a year that was already right', () => {
  // The one that must hold. Everything else here is a preference.
  const wrong = [];
  for (const [name, ours, spotify, musicbrainz, truth] of NINE) {
    const v = classifyYear({ ours, spotify, musicbrainz });
    if (v.verdict === 'confirmed' && truth === 'right') {
      wrong.push(`${name}: would have written ${v.year} over a correct ${ours}`);
    }
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`);
});

test('every year it does confirm is the right one', () => {
  const expected = {
    'Taylor Swift - Cruel Summer': 2019,
    'Bush - Machinehead': 1994,
    'Frankie Knuckles - Your Love': 1987,
    'Maneskin - Beggin': 2017,
  };
  const confirmed = {};
  for (const [name, ours, spotify, musicbrainz] of NINE) {
    const v = classifyYear({ ours, spotify, musicbrainz });
    if (v.verdict === 'confirmed') confirmed[name] = v.year;
  }
  assert.deepEqual(confirmed, expected);
});

test('a cover is held, not corrected', () => {
  // Spotify finds The Cure's 1987 original; MusicBrainz filters on an exact
  // artist and stays on Dinosaur Jr.'s 1989. The disagreement is the signal.
  const v = classifyYear({ ours: 1989, spotify: 1987, musicbrainz: 1989 });
  assert.equal(v.verdict, 'contradicted');
  assert.notEqual(v.verdict, 'confirmed');
});

test('a compilation date on one side alone is held', () => {
  // Sedaka: Spotify has a mis-dated 1960 compilation, MusicBrainz a 1993 one.
  // Two sources, both wrong, disagreeing - which must not read as corroboration.
  const v = classifyYear({ ours: 1962, spotify: 1960, musicbrainz: 1993 });
  assert.equal(v.verdict, 'check');
});

test('MusicBrainz alone does not move a year', () => {
  // 15.8% of batch 006 came back "ours is too early" from MusicBrainz and every
  // case read was MusicBrainz holding a reissue. Eric Carmen's wrong entry
  // carries 140 releases, so weight of evidence does not rescue it either.
  const v = classifyYear({ ours: 1975, spotify: null, musicbrainz: 1985 });
  assert.notEqual(v.verdict, 'confirmed');
});

test('Spotify alone does not move a year', () => {
  const v = classifyYear({ ours: 2003, spotify: 1987, musicbrainz: null });
  assert.equal(v.verdict, 'check');
  assert.equal(v.sources, 1);
});

test('an undisputed year is left alone', () => {
  assert.equal(classifyYear({ ours: 1978, spotify: 1978, musicbrainz: 1978 }).verdict, 'ok');
  assert.equal(classifyYear({ ours: 1978, spotify: null, musicbrainz: null }).verdict, 'ok');
  // Later than ours is a remaster and has never been interesting.
  assert.equal(classifyYear({ ours: 1978, spotify: 2018, musicbrainz: 2011 }).verdict, 'ok');
});

test('a one-year gap is a pressing date, not a disagreement', () => {
  // Both sources one year earlier is below MARGIN and says nothing.
  assert.equal(classifyYear({ ours: 1995, spotify: 1994, musicbrainz: 1994 }).verdict, 'ok');
});

test('two agreeing sources take the earlier year', () => {
  // Mayhem's album is 1994; MusicBrainz's earliest pressing of it is 1995.
  const v = classifyYear({ ours: 1999, spotify: 1994, musicbrainz: 1995 });
  assert.equal(v.verdict, 'confirmed');
  assert.equal(v.year, 1994);
});

test('a placeholder date is not a source', () => {
  // Spotify returns 1900 for "no idea" and marks it no differently from a real
  // date. Cutty Ranks' Limb By Limb came back 1900 against our 1993.
  const v = classifyYear({ ours: 1993, spotify: 1900, musicbrainz: 1993 });
  assert.equal(v.verdict, 'ok', 'a placeholder must not count as disputing');

  // And two placeholders must never read as two sources agreeing.
  const both = classifyYear({ ours: 1993, spotify: 1900, musicbrainz: 1900 });
  assert.notEqual(both.verdict, 'confirmed');
});

test('the thresholds are the ones the rule was fitted with', () => {
  // Both are load-bearing: MARGIN 1 would fire on every pressing date, and
  // TOLERANCE 0 would drop Mayhem, the only confirmed case where the two
  // sources differ at all.
  assert.equal(MARGIN, 2);
  assert.equal(TOLERANCE, 1);
});
