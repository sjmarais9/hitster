// Tests for what the generator decides about a candidate:
//   node --test scripts/seeds.test.mjs
//
// These four functions chose the tags on 9,469 songs. Nothing they produce is
// ever invalid, so nothing ever threw - the skew seed put every pre-2000 song
// on the adults' side across the whole batch and the only symptom was a night
// that felt oddly recent.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crowdDecade, genresOf, agreesWithEra, familiarityFor, skewFor, decadeOf, cleanTitle,
  reconcileYear,
  PLURALITY, SHARED, STANDARD, FAMILIAR, DECADE_YEARS,
} from './lib/seeds.mjs';

// --- the era the playlists agree on ------------------------------------------

test('a clear majority decides the era', () => {
  assert.equal(crowdDecade({ decades: { '1990s': 38, '2000s': 4 } }), '1990s');
});

test('a split vote decides nothing', () => {
  // Two decades at 35% each. Picking the larger would be picking noise.
  assert.equal(crowdDecade({ decades: { '1980s': 35, '1990s': 34, '2000s': 31 } }), null);
});

test('the threshold is a plurality, not a majority', () => {
  // 40% is enough on purpose: a song can genuinely appear on playlists either
  // side of its decade boundary without that meaning it is undated.
  assert.equal(crowdDecade({ decades: { '1970s': 40, '1980s': 30, '1990s': 30 } }), '1970s');
  assert.equal(crowdDecade({ decades: { '1970s': 39, '1980s': 31, '1990s': 30 } }), null);
  assert.ok(PLURALITY === 0.4);
});

test('no playlist evidence at all decides nothing', () => {
  assert.equal(crowdDecade({}), null);
  assert.equal(crowdDecade({ decades: {} }), null);
});

// --- genres ------------------------------------------------------------------

test('the two commonest themes become the genres', () => {
  assert.deepEqual(genresOf({ genres: { rock: 24, metal: 20, indie: 16, pop: 4 } }),
    ['rock', 'metal']);
});

test('a song with one theme gets one genre, not a padded pair', () => {
  assert.deepEqual(genresOf({ genres: { kwaito: 9 } }), ['kwaito']);
});

test('no theme at all falls back rather than writing an empty list', () => {
  // An empty genres array would put the song in "Everything else" forever and
  // trip the data invariants.
  assert.deepEqual(genresOf({}), ['pop']);
  assert.deepEqual(genresOf({ genres: {} }), ['pop']);
});

// --- the cross-check ---------------------------------------------------------

test('a year inside its era agrees', () => {
  assert.ok(agreesWithEra(1995, '1990s'));
  assert.ok(agreesWithEra(1990, '1990s'), 'the first year of a decade is inside it');
  assert.ok(agreesWithEra(1999, '1990s'), 'the last year of a decade is inside it');
});

test('a year outside its era is a clash', () => {
  assert.ok(!agreesWithEra(1989, '1990s'));
  assert.ok(!agreesWithEra(2000, '1990s'));
  // The real failure this catches: a remaster date on a sixties song.
  assert.ok(!agreesWithEra(2017, '1960s'));
});

test('every decade the app knows has a range, and they tile without gaps', () => {
  const eras = Object.keys(DECADE_YEARS);
  for (const era of eras) {
    const [lo, hi] = DECADE_YEARS[era];
    assert.equal(decadeOf(lo), era, `${era} starts at ${lo}`);
    assert.equal(decadeOf(hi), era, `${era} ends at ${hi}`);
    assert.equal(hi - lo, 9);
  }
  for (let i = 1; i < eras.length; i++) {
    assert.equal(DECADE_YEARS[eras[i]][0], DECADE_YEARS[eras[i - 1]][1] + 1, 'no gap between decades');
  }
});

test('an unknown era accepts anything rather than rejecting everything', () => {
  // The fallback in the generator is a wide-open range. Worth pinning: the
  // opposite default would silently reject every candidate.
  assert.ok(agreesWithEra(1995, '1890s'));
});

// --- the seeds ---------------------------------------------------------------

test('familiarity steps at its thresholds', () => {
  assert.equal(familiarityFor(100), 'standard');
  assert.equal(familiarityFor(STANDARD), 'standard');
  assert.equal(familiarityFor(STANDARD - 1), 'familiar');
  assert.equal(familiarityFor(FAMILIAR), 'familiar');
  assert.equal(familiarityFor(FAMILIAR - 1), 'deep');
  assert.equal(familiarityFor(0), 'deep');
});

test('hip hop and R&B enter lower than their global numbers suggest', () => {
  // Measured, not guessed: a review of twenty songs found 80% of this genre
  // tagged as better known than it is, against 33% of everything else, and
  // every correction went downward. Terror Squad's Lean Back arrived as
  // `standard` on a US chart position.
  assert.equal(familiarityFor(90, ['rock']), 'standard');
  assert.equal(familiarityFor(90, ['hip hop']), 'familiar', 'the same score, damped');
  assert.equal(familiarityFor(50, ['r&b']), 'deep');
  assert.equal(familiarityFor(50, ['rock']), 'familiar');
});

test('the damping reaches every name the genre travels under', () => {
  for (const genre of ['hip hop', 'rap', 'r&b', 'grime', 'trap']) {
    assert.equal(familiarityFor(90, [genre]), 'familiar', genre);
  }
  // And leaves everything else alone, including the neighbours it is easy to
  // catch by accident. Enigma was corrected upward, so damping dance would
  // have made that one worse.
  for (const genre of ['rock', 'pop', 'soul', 'funk', 'dance', 'country', 'amapiano']) {
    assert.equal(familiarityFor(90, [genre]), 'standard', genre);
  }
});

test('a song with no genres is not damped', () => {
  assert.equal(familiarityFor(90), 'standard');
  assert.equal(familiarityFor(90, []), 'standard');
});

test('every familiarity seed is a value the sampler knows', () => {
  const known = ['standard', 'familiar', 'deep'];
  for (let p = 0; p <= 100; p++) assert.ok(known.includes(familiarityFor(p)), `p=${p}`);
});

test('recent music goes to the children, as it always did', () => {
  assert.equal(skewFor(2020, 10), 'kids');
  assert.equal(skewFor(2015, 99), 'kids');
});

test('the 2005-2014 band is judged, not waved through', () => {
  // It returned `even` for everything on the year alone, which the calibration
  // round found was wrong eight times in ten - Sleeping With Sirens at
  // canonicity 7 was being offered to the children as common ground.
  assert.equal(skewFor(2011, 7), 'adults');
  assert.equal(skewFor(2010, SHARED - 1), 'adults');
  assert.equal(skewFor(2010, SHARED), 'even', 'a genuine crossover still crosses');
  // And no cliff at either boundary: 2004 and 2005 are now judged alike.
  assert.equal(skewFor(2004, 50), skewFor(2005, 50));
  assert.equal(skewFor(2014, 90), skewFor(2015 - 11, 90));
});

test('a well-known old song is shared rather than kept from the children', () => {
  // The bug this replaced: every pre-2005 song was `adults`, whatever it was.
  assert.equal(skewFor(1975, 95), 'even', 'Stairway to Heaven is not adults-only');
  assert.equal(skewFor(1975, SHARED), 'even');
});

test('an obscure old song still belongs to the adults', () => {
  assert.equal(skewFor(1975, SHARED - 1), 'adults');
  assert.equal(skewFor(1975, 5), 'adults');
});

test('the seed can never again put every old song on one side', () => {
  // Guards the original bug: every pre-2000 song tagged `adults`, which made a
  // Balanced crowd mean a night of nothing older than Hey Ya.
  //
  // The bar was 25% and is now 15%, which was loosened to let SHARED rise from
  // 65 to 80 - so it deserves saying plainly rather than quietly. Two reasons it
  // is not just moving the goalposts. The 25% was arbitrary: it counts a uniform
  // sweep of canonicity scores, which is not how songs are distributed. And the
  // authoritative version of this property is measured on the real pool in
  // data.test.mjs, where the children's side is 26.0% pre-2000 after the change
  // - comfortably clear, and that is the number that describes actual nights.
  //
  // What must not happen is this reaching zero. That is what 15% is here for.
  const scores = Array.from({ length: 101 }, (_, i) => i);
  const shared = scores.filter((p) => skewFor(1985, p) !== 'adults').length;
  assert.ok(shared / scores.length > 0.15,
    `only ${shared}% of the canonicity range leaves a 1985 song shareable`);
});

test('every skew seed is a value the sampler knows', () => {
  const known = ['adults', 'even', 'kids'];
  for (const year of [1955, 1975, 1999, 2004, 2005, 2014, 2015, 2026]) {
    for (const p of [0, 50, 64, 65, 100]) {
      assert.ok(known.includes(skewFor(year, p)), `${year}/${p}`);
    }
  }
});

test('a version suffix is stripped, because a remaster is the same song', () => {
  assert.equal(cleanTitle('Should I Stay or Should I Go (Remastered)'), 'Should I Stay or Should I Go');
  assert.equal(cleanTitle("Ain't Nobody (Remix)"), "Ain't Nobody");
  assert.equal(cleanTitle('Karma Chameleon (Remastered 2002)'), 'Karma Chameleon');
  assert.equal(cleanTitle('Pony (Extended Mix)'), 'Pony');
  assert.equal(cleanTitle('Bohemian Rhapsody - 2011 Remaster'), 'Bohemian Rhapsody');
});

test('a parenthetical that is part of the song survives', () => {
  // The whole risk of stripping: these read like decoration and are not. A
  // featured artist changes who is on the card, and Gypsy Woman is known by the
  // half that would have been cut.
  assert.equal(cleanTitle('Jenny from the Block (feat. Jadakiss)'), 'Jenny from the Block (feat. Jadakiss)');
  assert.equal(cleanTitle("Gypsy Woman (She's Homeless)"), "Gypsy Woman (She's Homeless)");
  assert.equal(cleanTitle('Africa'), 'Africa');
});

test('stripping leaves genuine karaoke and tributes still catchable', () => {
  // cleanTitle runs before the junk filter, so it must not launder an actual
  // karaoke recording into something that reads as the real single.
  for (const junk of ['Karaoke Version of Hey Jude', 'Hey Jude (In the Style of The Beatles)']) {
    assert.match(cleanTitle(junk), /karaoke|in the style of/i, `${junk} lost its tell`);
  }
});

test('cleanTitle is idempotent', () => {
  const once = cleanTitle('Ain\'t Nobody (Remix)');
  assert.equal(cleanTitle(once), once);
});

test('two sources landing on the same year corroborate it', () => {
  const r = reconcileYear({ musicbrainz: 1978, itunes: 1978 });
  assert.equal(r.year, 1978);
  assert.equal(r.corroborated, true);
});

test('a year apart is a pressing date, and the earlier one wins', () => {
  // Same rule year-check.mjs applies to the pool: the later of two close dates
  // is almost always a reissue, so agreement is within TOLERANCE and the
  // earlier is taken.
  const r = reconcileYear({ musicbrainz: 1979, itunes: 1978 });
  assert.equal(r.year, 1978);
  assert.equal(r.corroborated, true);
});

test('one source alone is used but not corroborated', () => {
  const r = reconcileYear({ musicbrainz: 1984, itunes: null });
  assert.equal(r.year, 1984);
  assert.equal(r.corroborated, false, 'a single source must still face the era check');
});

test('sources that disagree corroborate nothing, and MusicBrainz leads', () => {
  // The failure this protects: MusicBrainz holding a CD reissue while iTunes
  // has the original, or the reverse. Neither is trusted, so the era check -
  // weak as it is - is still the thing that decides.
  const r = reconcileYear({ musicbrainz: 1965, itunes: 1987 });
  assert.equal(r.year, 1965);
  assert.equal(r.corroborated, false);
});

test('no source at all returns nothing rather than a guess', () => {
  assert.equal(reconcileYear({ musicbrainz: null, itunes: null, deezer: null }), null);
});

test('a third source can corroborate where the first two did not', () => {
  // MusicBrainz alone against two that agree with each other: the pair wins,
  // because two independent catalogues landing together is the whole rule.
  const r = reconcileYear({ musicbrainz: 1999, itunes: 1978, deezer: 1978 });
  assert.equal(r.year, 1978);
  assert.equal(r.corroborated, true);
});
