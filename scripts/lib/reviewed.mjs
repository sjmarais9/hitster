// Songs the household has actually judged, and what they said.
//
// This file exists because a rule quietly undid them once. The skew review of
// 15 August raised SHARED to 80 and re-ran the seed over every song to make the
// data agree with it - which flipped seven songs the earlier review that same
// day had corrected by hand back to what the machine thought. Both changes were
// right on their own. The damage was in the seam between them.
//
// So the judgements live here, in one place, and data.test.mjs asserts the
// shipping data still matches. Any future rule that disagrees with a person
// now fails the build instead of winning silently.
//
// `familiarity` is absent where the review did not ask about it. That is not
// the same as no opinion, and a rule may still seed it.

/** artist|title, lower case, exactly as it appears in the data. */
export const REVIEWED = {
  // --- 15 August, the familiarity review -------------------------------------
  'beyoncé|beautiful liar': { familiarity: 'familiar', skew: 'adults' },
  'creed|one last breath': { familiarity: 'familiar', skew: 'adults' },
  'busta rhymes|break ya neck': { familiarity: 'deep', skew: 'adults' },
  'outkast|so fresh, so clean': { familiarity: 'familiar', skew: 'adults' },
  '50 cent|ayo technology': { familiarity: 'deep', skew: 'adults' },
  'terror squad|lean back': { familiarity: 'deep', skew: 'adults' },
  'jimmy eat world|sweetness': { familiarity: 'deep', skew: 'adults' },
  'tevin campbell|alone with you': { familiarity: 'deep', skew: 'adults' },
  'freemasons|love on my mind (feat. amanda wilson)': { familiarity: 'deep', skew: 'adults' },
  'mr. big|to be with you': { familiarity: 'familiar', skew: 'adults' },
  'dave matthews band|crash into me': { familiarity: 'standard', skew: 'adults' },
  'enigma|return to innocence': { familiarity: 'standard', skew: 'adults' },
  // Confirmed as already correct. Recorded so a re-seed cannot undo them either.
  'green day|21 guns': { familiarity: 'standard', skew: 'even' },
  'red hot chili peppers|snow (hey oh)': { familiarity: 'standard', skew: 'even' },
  'coi leray|players': { familiarity: 'standard', skew: 'kids' },
  'diana ross & the supremes|love child': { familiarity: 'deep', skew: 'adults' },
  'jawbreaker|save your generation': { familiarity: 'deep', skew: 'adults' },
  'rodney crowell|she\'s crazy for leaving (album version)': { familiarity: 'deep', skew: 'adults' },

  // --- 15 August, the skew review --------------------------------------------
  // "adults only" - you know it, the children do not. Familiarity was not asked.
  'mariah carey|honey': { skew: 'adults' },
  'avenged sevenfold|unholy confessions': { skew: 'adults' },
  'jaÿ-z|03\' bonnie & clyde': { skew: 'adults' },
  'sugar ray|every morning': { skew: 'adults' },
  'usher|burn (confession special edition version)': { skew: 'adults' },
  'bob marley & the wailers|roots, rock, reggae': { skew: 'adults' },
  'julio iglesias|to all the girls i\'ve loved before (with willie nelson)': { skew: 'adults' },

  // "nobody here" - not known at that table at all. That is a familiarity
  // answer as much as a skew one, so both are recorded.
  'isaac hayes|walk on by': { familiarity: 'deep', skew: 'adults' },
  'double you|please don\'t go': { familiarity: 'deep', skew: 'adults' },
  'sananda maitreya|sign your name': { familiarity: 'deep', skew: 'adults' },
  'chaka khan|i\'m every woman': { familiarity: 'deep', skew: 'adults' },
  'ciara|1, 2 step (feat. missy elliott)': { familiarity: 'deep', skew: 'adults' },
  'alan jackson|here in the real world': { familiarity: 'deep', skew: 'adults' },
  'sly & the family stone|if you want me to stay': { familiarity: 'deep', skew: 'adults' },
  'montell jordan|get it on tonite': { familiarity: 'deep', skew: 'adults' },
  'slowdive|alison': { familiarity: 'deep', skew: 'adults' },
  'ashanti|unfoolish': { familiarity: 'deep', skew: 'adults' },
  'club nouveau|rumors': { familiarity: 'deep', skew: 'adults' },
  'mega banton|sound boy killing': { familiarity: 'deep', skew: 'adults' },
  'the cleaners from venus|living on nerve ends': { familiarity: 'deep', skew: 'adults' },
};

/** The key a song is recorded under. */
export const reviewKey = (song) => `${song.artist}|${song.title}`.toLowerCase();

/** What the household said about this song, or null if it was never asked. */
export const verdictFor = (song) => REVIEWED[reviewKey(song)] ?? null;
