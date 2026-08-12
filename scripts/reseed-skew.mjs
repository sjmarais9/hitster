// Re-seed `skew` for the music that predates the children.
//
// The bug this fixes was mine, and the generator only amplified it. Rule 8 in
// docs/tagging.md says a song the family shares is `even`, not `adults` - but
// the hand-tagging read `kids` as "music from the children's era" instead, and
// left every decade before 2000 at about 99% adults. The generator measured
// that relationship across the existing pool, believed it, and applied
//
//   skewFor = year < 2005 ? 'adults' : year < 2015 ? 'even' : 'kids'
//
// to 5,668 more songs.
//
// What it cost: of 1,341 songs tagged `kids`, 99% were 2010s or 2020s and not
// one was pre-2000. The crowd slider is normalised by population, so Balanced
// has to find half the night from the children's side - and with nothing older
// than Hey Ya on that side, Balanced meant the 1990s got 13.4% of the draw
// against 26.2% at the adults' end. That is not a balanced night. It is two
// separate games, the grown-ups getting pre-2000 and the children getting the
// last fifteen years.
//
// No sampling parameter can fix it, because no fader moves a song from one side
// of the crowd slider to the other. The tag has to change.
//
// The rule here: a pre-2005 song in the top third of its decade by canonicity
// becomes `even`. That is rule 8 applied with the data we already have - the
// songs that cross generations are the ones everyone knows - and it stays a
// seed rather than a judgement, which the review and the sampler can both move.
//
//   node scripts/reseed-skew.mjs --dry              see what would change
//   node scripts/reseed-skew.mjs                    write it
//   node scripts/reseed-skew.mjs data/songs.json    just these files
//
// Idempotent: a song already at `even` or `kids` is never touched, so running
// it twice changes nothing the second time.

import { readSongs, writeSongs } from './lib/songs-file.mjs';

const ALL_FILES = [
  'data/songs.json',
  'data/batch-002.seed.json',
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

// Top third of each decade. canonicity is a within-decade percentile, so this
// compares like with like: a 1967 song is judged against other 1967 songs, not
// against Blinding Lights.
const THRESHOLD = Number(arg('--threshold') ?? 65);

// The generator's own boundary. After 2005 it already seeds `even` or `kids`,
// and those tiers are not the broken ones.
const CUTOFF = 2005;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const dry = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
const targets = files.length ? files : ALL_FILES;

const DEC = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s'];

let moved = 0;
let unmeasured = 0;
let eligible = 0;
const byDecade = {};
const samples = [];

for (const file of targets) {
  const doc = await readSongs(file, null);
  if (!doc) { console.log(`${file.padEnd(30)} not found, skipped`); continue; }

  let here = 0;
  for (const song of doc.songs ?? []) {
    // Only the tier the mistake is in. Anything already crossing generations
    // stays as it is.
    if (song.skew !== 'adults' || song.year >= CUTOFF) continue;
    eligible++;

    // Nothing measured means nothing to judge on. Leaving it at `adults` is the
    // conservative half of the error rather than a guess in the other direction.
    if (song.canonicity === null || song.canonicity === undefined) { unmeasured++; continue; }
    if (song.canonicity < THRESHOLD) continue;

    song.skew = 'even';
    here++;
    moved++;
    byDecade[song.decade] = (byDecade[song.decade] ?? 0) + 1;
    if (samples.length < 24 && song.canonicity >= 80) {
      samples.push(`${song.artist} - ${song.title}`.slice(0, 46).padEnd(48) + `${song.decade}  ${song.canonicity}`);
    }
  }

  if (!dry && here) await writeSongs(file, doc);
  console.log(`${file.padEnd(30)} ${String(here).padStart(5)} moved to even`);
}

console.log(`\n${moved} songs moved from adults to even, of ${eligible} pre-${CUTOFF} adults songs`);
console.log(`  threshold: canonicity >= ${THRESHOLD} (top ${100 - THRESHOLD}% of each decade)`);
if (unmeasured) console.log(`  ${unmeasured} left alone - no canonicity measured, nothing to judge on`);

console.log('\nby decade:');
for (const d of DEC) if (byDecade[d]) console.log(`  ${d}  ${byDecade[d]}`);

if (samples.length) {
  console.log('\na sample of what crossed over - these should read as songs a\n' +
    'teenager in this house would place:\n');
  for (const s of samples) console.log(`  ${s}`);
}

if (dry) console.log('\n--dry: nothing was written.');
