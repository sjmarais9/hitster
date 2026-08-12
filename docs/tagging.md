# Tagging guide: familiarity and skew

How every song in the pool gets its `familiarity` and `skew` values. These are
**our** values, assigned when the song is generated, exactly like `year`. No
Spotify field ever overwrites them.

This file exists because the pool is built across dozens of batches and many
sessions. Anything not written down here will drift.

## The audience

Tag relative to **this specific room**, not to the world:

- South Africans in their forties
- Their children, aged roughly 10 to 17
- Musical taste leans rock and alternative; they are more knowledgeable there
  than in other genres

A song is not "well known" in the abstract. It is well known *to these people*.

## `familiarity`

How likely the room is to recognise the song. Three values, and the tier is
judged across **both** generations at once.

| Value | Test |
|---|---|
| `standard` | Both a forty-something and a thirteen-year-old would recognise it |
| `familiar` | One generation knows it solidly, the other has plausibly heard it |
| `deep` | One generation only, or genuinely enthusiast territory |

Worked examples, agreed with the owner:

- `standard` — Billie Jean, Africa, Sweet Child O' Mine, Smells Like Teen
  Spirit, Wonderwall, Dancing Queen, Blinding Lights, Uptown Funk, Jerusalema,
  Nkalakatha
- `familiar` — Superstition, Go Your Own Way, Rehab, Get Lucky, Hey Ya!,
  HUMBLE., As It Was, Water, Rolling in the Deep, Clint Eastwood
- `deep` — Hit the Road Jack, Good Vibrations, Bad Moon Rising, What's Going On,
  London Calling, Nuthin' but a 'G' Thang, Scatterlings of Africa

### Where the familiar/deep line actually sits

Established by putting 20 `deep` songs from batch 004 in front of the owner.
Use this before reaching for `deep`:

| | |
|---|---|
| Mainstream rock and metal, roughly **1984-2003** | `familiar`, occasionally `standard` |
| Indie, underground, post-punk, shoegaze | `deep` |
| Anything **pre-1980** | `deep` unless a genuine mega-hit |
| Pop, hip hop, r&b, dance, any era | `deep` unless a genuine mega-hit |

Worked examples from the review. The pairs matter more than the singles,
because they show the line rather than a point:

- Same year, opposite calls: Metallica's *Creeping Death* (1984) is `familiar`,
  The Smiths' *How Soon Is Now?* (1984) is `deep`. Mainstream metal versus indie.
- Same year again: Pearl Jam's *Even Flow* (1991) is `standard`, Red Hot Chili
  Peppers' *Suck My Kiss* (1991) is `deep`. Both rock, but one is an album
  everyone owned and the other is a deeper cut.
- Album fame does not carry: a *Thriller* track stayed `deep` while a Black
  Album track went `familiar`. The band's standing with this household decides
  it, not the album's.

**Three mechanical rules were tried on this and all failed** - genre alone,
formative-years window alone, and genre plus era with an artist-frequency
proxy. Each landed near 50% accuracy. The line is real but it is not
computable; judge song by song.

### `deep` is over-used, and it is the standing error

Batch 004 came out 73% `deep`, and the review found three of twenty songs
under-tagged: Two Princes, Hanging by a Moment and Thunderstruck were all a tier
lower than they should have been. Extrapolated, a meaningful share of that 73%
belongs in `familiar`.

The cause is that `deep` is the safe-feeling default when a song is not
obviously huge. It is not safe. A song wrongly marked `deep` disappears from
every casual and confident game, which is worse than being drawn slightly too
often. **When hesitating between `familiar` and `deep`, ask whether a
forty-something who followed music at the time would place it. If yes, it is
`familiar`.**

### The tier saturates

There are only so many genuinely universal songs — on the order of 1,500. Do not
inflate `standard` to hit a quota as the pool grows. A large pool is mostly
`deep`, and that is correct. Filtering is what makes it playable.

## `skew`

Which half of the table has the advantage. Three values: `even`, `adults`,
`kids`.

- `adults` — the forty-somethings will get it, the children will not
- `kids` — the children will get it, the parents will not
- `even` — neither side has an edge

`skew` is independent of `familiarity`. A song can be `deep` and `kids`
(genre-specific current hip hop, amapiano, K-pop) just as easily as `deep` and
`adults`. Deliberately include `deep` + `kids` songs, or the children only ever
lose to their parents' back catalogue.

## Rules learned

Added to as the owner corrects tagging. Each of these overrides intuition.

1. **South African anthems travel further down the age range than their
   international streaming numbers suggest.** Nkalakatha and Jerusalema are both
   `standard`, not `familiar`. Apply the same to Brenda Fassie, Mafikizolo,
   Freshlyground and comparable local staples: tag them higher than a global
   view would.

2. **`even` is rarer than it looks. This house is more generationally siloed
   than it appears.** In the batch 002 review, half of every `even` tag put in
   front of the owner came back corrected, almost always to `adults`. Do not
   reach for `even` as a default. Reserve it for songs with real evidence of
   crossing, and pick a side otherwise.

3. **A pre-1990 song being famous does not mean the children know it.** Three
   Little Birds, Don't Stop Believin' and Never Gonna Give You Up were all
   tagged `standard` / `even` and all came back skewed to `adults`. Fame within
   the parents' generation is not reach across generations. Rickrolling, Glee
   and advert placement are weaker signals than they look.

4. **Recent chart pop is less familiar here than its streaming numbers
   suggest.** Levitating and Kill Bill both came down from `familiar` to `deep`,
   and Heat Waves from `standard` to `familiar`. A song being enormous on
   streaming says little about whether this particular family can place it. Tag
   recent pop conservatively.

8. **What decides `even` is whether the family experienced it *together*.** This
   supersedes the mechanism in rule 7, though not its conclusions.

   Rule 7 said participation crosses and media placement does not. Batch 004
   broke that in both directions. Mamma Mia is pure media placement and it
   crossed. September, Footloose and I Got You are all participatory dancefloor
   songs and none of them did.

   The rule that fits every case so far is about *context*, not medium. A song
   crosses if it happens in a room the children are in:

   - **Crosses**: stadium and sport chants, family films, anything watched or
     sung together at home. We Will Rock You, We Are the Champions,
     Thunderstruck, Chelsea Dagger, Mamma Mia, The Best.
   - **Does not cross**: weddings, clubs, karaoke nights, parties from your own
     era. September, Footloose, I Got You, All the Small Things.

   Ask "were the children in the room", not "is the song participatory".

9. **Do not generalise from a band to its catalogue.** Muse's Hysteria came back
   `even` because the children found the band themselves. The identical
   inference applied to Arctic Monkeys' Fluorescent Adolescent was wrong and it
   stayed `adults`. One song crossing says nothing about the next.

7. **Participatory life crosses generations. Media placement does not.**
   *Superseded by rule 8. Kept for the reasoning, which still holds for media
   placement even though the participation half was wrong.*

   In the batch 003 review, every `even` justified by a film, soundtrack, TV
   revival or "the kids still stream it" came back `adults`: Running Up That
   Hill (Stranger Things), Creep, Johnny Cash's Hurt, All My Life, Supermassive
   Black Hole (Twilight). Every `even` justified by something people *do* with
   the song held: Don't Stop Me Now, Y.M.C.A., Nothing Else Matters, Hallelujah
   - parties, weddings, sport, karaoke, talent shows.

   Watching something is not knowing it. Ask whether the children have ever
   *participated* in the song, not whether they have been exposed to it. This
   supersedes the weaker version of the same idea in rule 3.

6. **The rules above are asymmetric, and applying them mechanically collapses
   the distribution.** Rules 2, 3 and 4 all push the same way: toward `adults`
   and toward lower tiers. Nothing here pushes back. Batch 003 was generated by
   following them across 500 songs with no counterweight and came out at 0.6%
   `standard` and 73% `adults`, which is not a judgement about music, it is an
   artefact of one-directional rules. **Run `check-tags.mjs` on a batch before
   submitting it for review, and treat an implausible distribution as evidence
   the rules were over-applied rather than as a finding about the songs.**

5. **Genre is not a shortcut.** A tempting reading of the early corrections was
   that rock runs higher in this house and should be tagged up. It did not hold:
   in the same review Metallica's "One" came *down* to `deep` while Nine Inch
   Nails' "Closer" went *up* to `familiar`. Judge each song, do not apply a
   genre-wide adjustment.

## Traps

- **Spotify `popularity` is not available, and would not have been trusted
  anyway.** Spotify does not return the field to this app: it is absent from
  search results and from `GET /tracks/{id}`, and `GET /tracks?ids=` is 403.
  That is the post-2024 restriction on development-mode apps. Even with it, it
  measures current streaming rather than familiarity - inflating meme revivals,
  deflating songs everyone knows but nobody streams - so it was only ever
  intended as a disagreement signal, never as an authority.
- **TikTok revivals** genuinely do move older songs from `adults` to `even`.
  Check whether a song has had a second life before assuming the children have
  not heard it.
- **Recognising is not dating.** Hitster asks players to place a song on a
  timeline. A song can be instantly recognisable and still hard to date. That is
  the game working as intended, and is not a reason to change the tier.

## Batch and review process

- Batch one is 250 songs. Every batch after is 500.
- The owner reviews **20 songs per batch**: the 10 the generator was least
  confident about, plus 10 chosen at random as an unbiased check.
- **"I don't know it" is an answer, not a non-answer.** If the owner does not
  recognise a song, the adult half of the table does not have it, which settles
  `skew` even when it leaves the tier unverified.
- When a sampled correction reveals a *category* of error rather than a one-off,
  fix the whole category across the batch rather than only the songs that
  happened to be sampled. That is the entire value of sampling at 4%.
- Corrections are written back into "Rules learned" above as *principles*, not
  just as fixes to those songs.
- Every fifth batch, 20 songs from an earlier approved batch are re-tagged blind
  and compared against their approved values. A disagreement rate above roughly
  15% means the rules here need sharpening before more batches are generated.
- `scripts/check-tags.mjs` reports distribution drift and flags songs that
  contradict the rules above, artists tagged inconsistently across the pool, and
  integrity problems. No network, no auth.

### What the review can and cannot catch

This matters for choosing a batch size, so it is stated plainly.

The original plan had an automated cross-check against Spotify popularity
catching the individual errors a small sample cannot reach. **That check does not
exist** - see the trap above - and nothing else can replace it, because there is
no external opinion on how well *this family* knows a song.

What survives:

- **Sampled review** catches systematic bias. A tendency to over-tag `even`, or
  to overrate pre-1990 reach, shows up in any sample. This works.
- **`check-tags.mjs`** catches self-contradiction: a tag that breaks a rule here,
  an artist tagged three different ways, a decade that disagrees with its year.
  It cannot tell a wrong tag from a right one.
- **Blind drift audits** catch inconsistency over time.
- **Actual games** catch everything else, slowly.

What is genuinely uncaught: an individually wrong tag on a song that breaks no
rule, sits consistently with its artist, and is not in the sample. At a 20-song
sample of 500, that is most of the batch. The honest position is that individual
tags are not verified, only the tagger's calibration is.

**Decided:** this is accepted. Batches stay at 500 with a 20-song review, and a
residual rate of individually wrong tags is the price of reaching 10,000 songs.
A wrong `familiarity` makes a card easier or harder than the filter promised; it
does not break a round the way a wrong `year` would. Errors are expected to be
found in play rather than in review.

## Distribution targets

Per batch, approximately:

| Decade | Share |
|---|---|
| pre-1970 | 5% |
| 1970s | 12% |
| 1980s | 18% |
| 1990s | 24% |
| 2000s | 18% |
| 2010s | 15% |
| 2020s | 8% |

Roughly 45% rock and alternative, the rest spread across pop, hip hop, soul and
funk, electronic, metal and country. South African content **at most 5%**,
spread through the decades rather than clustered.

Batch 002 came out at 58% rock and alternative. That batch stands, but later
batches must pull back toward 45% — the other genres need the room.

Batch 002 also came out with only 8% `skew: kids` against 57% `adults`, which
would have the children losing most rounds. Later batches need materially more
`kids` material, including `deep` + `kids`.
