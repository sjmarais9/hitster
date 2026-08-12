# How accurate are the years?

`year` is the one field that genuinely breaks the game when wrong. Everything
else makes a card easier or harder than intended; a wrong year makes the card
unplaceable. This records what the years are actually worth, measured rather
than assumed.

Regenerate with `node scripts/audit-years.mjs` (about half an hour, one request
per second as MusicBrainz asks).

## Generated years — batch 006 onward

Measured by running the generator's own year logic over 1,458 songs whose years
we already knew:

| | exact | within a year |
|---|---|---|
| MusicBrainz raw | 81.5% | 93.8% |
| **after the decade cross-check** | **86.3%** | **98.4%** |

The cross-check is worth its rejections. It discards any year that disagrees
with the decade the song's playlists place it in, which costs candidates — 59.4%
of songs survive it — and buys five points of exactness and 98.4% within a year.

**98.4% within a year is the number that matters.** Cards are placed relative to
each other on a timeline, so being one year out is almost never what loses a
round. Being twenty years out is, and that is what the cross-check catches.

## Source comparison

All three measured against the same 60 known songs, so the numbers are
comparable.

| Source | exact | fails where |
|---|---|---|
| iTunes | 88% | nowhere in particular; 6/9 even in the 1960s |
| MusicBrainz release-groups | 84% | no record at all for 5,933 candidates, and only 4% of African music |
| Deezer | 37% | everything before 1990 — returns remaster pressings |

Order of use is MusicBrainz, then iTunes, then Deezer for post-2000 songs only.
Every answer passes the same cross-check, so a fallback can rescue a song that
had no year but cannot introduce a wrong one.

MusicBrainz **recordings** were tried first and were useless: `first-release-date`
on a recording reflects the earliest release catalogued, and old vinyl singles
are patchily covered while their CD reissues are not. It dated *Jailhouse Rock*
to 1977 and *Hit the Road Jack* to 1989. Release-groups fixed it.

## Hand-written years — batches 002 to 005

**14 disagreements out of 866 confidently checkable, 1.6%.**

The true rate is lower, because disagreements cut both ways:

| Song | ours | MusicBrainz | verdict |
|---|---|---|---|
| Nina Simone — Sinnerman | 1965 | 2003 | reissue; ours right |
| Bill Haley — Rock Around the Clock | 1954 | 1967 | reissue; ours right |
| Whitesnake — Here I Go Again | 1987 | 1982 | both right — original and hit re-recording |
| Johnny Cash — Folsom Prison Blues | 1955 | 1968 | both right — studio and the famous live version |
| MGMT — Time to Pretend | 2008 | 2005 | MusicBrainz right; the EP predates the album |

Only a handful are plain mistakes. No corrections were made as a result — the
audit existed to replace an unquantified risk with a number, and the number is
fine.

## What none of this catches

**Errors inside the same decade.** The cross-check compares a year against a
decade, so a song dated three years out passes unnoticed. iTunes returned 1955
for *Johnny B. Goode* against a true 1958, and nothing downstream would object.

Every source makes errors of that size. The pipeline reliably catches
twenty-year misses and never catches three-year ones. For this game that is the
right trade, but the years are defensibly good rather than perfect, and should
be described that way.

**Songs with two honest answers.** A studio original and a famous live version,
an EP and the album that followed it. These are not errors in either source and
no amount of cross-checking resolves them; somebody has to decide which the game
means.
