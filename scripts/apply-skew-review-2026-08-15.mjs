// Applies the skew review of 15 August to batch 006.
//
// Two things. The twenty reviewed songs get what the review said. Everything
// else machine-seeded gets re-run through skewFor at the new SHARED of 80,
// because the seed change alone would do nothing - batch 006 is the last batch
// and there is no future generation for it to affect.
//
// Hand-tagged files are left alone. A rule does not overwrite a judgement.
import { readSongs, writeSongs } from 'file:///C:/Projects/hitster/scripts/lib/songs-file.mjs';
import { skewFor } from 'file:///C:/Projects/hitster/scripts/lib/seeds.mjs';

const FILE = 'C:/Projects/hitster/data/batch-006.seed.json';

// "adults" = you know it, the children do not.
const ADULTS = [
  'mariah carey|honey',
  'avenged sevenfold|unholy confessions',
  'jaÿ-z|03\' bonnie & clyde',
  'sugar ray|every morning',
  'usher|burn (confession special edition version)',
  'bob marley & the wailers|roots, rock, reggae',
  'julio iglesias|to all the girls i\'ve loved before (with willie nelson)',
];

// "nobody here" = not known at that table at all. That is a familiarity
// judgement as much as a skew one, so both move.
const UNKNOWN = [
  'isaac hayes|walk on by',
  'double you|please don\'t go',
  'sananda maitreya|sign your name',
  'chaka khan|i\'m every woman',
  'ciara|1, 2 step (feat. missy elliott)',
  'alan jackson|here in the real world',
  'sly & the family stone|if you want me to stay',
  'montell jordan|get it on tonite',
  'slowdive|alison',
  'ashanti|unfoolish',
  'club nouveau|rumors',
  'mega banton|sound boy killing',
  'the cleaners from venus|living on nerve ends',
];

const key = (s) => `${s.artist}|${s.title}`.toLowerCase();
const dry = process.argv.includes('--dry-run');

const doc = await readSongs(FILE);
let judged = 0;
let reseeded = 0;
let matched = 0;

doc.songs = doc.songs.map((song) => {
  const k = key(song);

  if (ADULTS.includes(k)) {
    matched++;
    judged++;
    return { ...song, skew: 'adults' };
  }
  if (UNKNOWN.includes(k)) {
    matched++;
    judged++;
    return { ...song, skew: 'adults', familiarity: 'deep' };
  }

  if (song.canonicity == null) return song;
  const next = skewFor(song.year, song.canonicity);
  if (next === song.skew) return song;
  reseeded++;
  return { ...song, skew: next };
});

if (!dry) await writeSongs(FILE, doc);

console.log(`${judged} tags set from the review (${matched}/${ADULTS.length + UNKNOWN.length} matched by name)`);
console.log(`${reseeded} other songs re-seeded at the new threshold`);
if (dry) console.log('\n--dry-run: nothing written.');
