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

## Traps

- **Spotify `popularity` is not familiarity.** It measures current streaming.
  It inflates meme revivals and deflates songs everyone knows but nobody
  streams. It is recorded as advisory data only, in `data/popularity.json`,
  never in the pool.
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
- Corrections are written back into "Rules learned" above as *principles*, not
  just as fixes to those songs.
- Every fifth batch, 20 songs from an earlier approved batch are re-tagged blind
  and compared against their approved values. A disagreement rate above roughly
  15% means the rules here need sharpening before more batches are generated.
- `scripts/check-familiarity.mjs` cross-references the pool against Spotify
  popularity and flags disagreements across the whole batch, catching individual
  errors the 4% sample cannot.

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
