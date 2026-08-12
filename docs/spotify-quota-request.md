# Spotify extended quota request

Draft answers for the extension request on the Hitster app in the Spotify
Developer Dashboard. Written to be submitted honestly: this is a personal family
project, and saying otherwise risks the app being revoked, which would break the
whole thing.

## Why we want it

Three concrete problems, all caused by development-mode restrictions:

1. **Daily rate quota.** Resolving a batch of 500 songs exhausts it. One run
   returned `Retry-After: 76289` — a 21-hour lockout. There are roughly 2,300
   songs waiting to be resolved, which is about five days of runs.
2. **`popularity` is stripped** from every track object, on search and on
   `GET /tracks/{id}` alike.
3. **`GET /tracks?ids=` returns 403** regardless of how many ids are passed.

Only the first is really about quota; 2 and 3 are the November 2024 endpoint
restrictions. **Extended quota may not restore them** — it is unclear whether
the restored surface applies to newly granted apps or only to those that already
held extended access. Do not assume this fixes 2 and 3.

## Where to apply

Developer Dashboard → the Hitster app → **Settings**, or an "extension request"
link on the app overview. Exact placement moves around.

## Draft answers

Field names vary; map these onto whatever the form asks.

**What does your app do?**

> A progressive web app that acts as a digital card deck for the physical board
> game Hitster. It draws a random song from a curated pool, plays it through the
> Web Playback SDK with the title, artist and year hidden, and reveals them when
> a player taps a button. All game mechanics — timelines, tokens, scoring, turn
> order — stay physical on the table. The app replaces the fixed card set the
> boxed game ships with, so the song pool can be tailored to the people playing.

**How does it use the Web API?**

> Authorization Code Flow with PKCE for login. The Web Playback SDK for
> playback, with a fallback to the device transfer and play endpoints when the
> SDK fails to initialise, which happens on some Android Chrome builds. The
> search endpoint is used by an offline import script that resolves a curated
> list of songs to track URIs once, ahead of play. No user data is collected,
> stored or transmitted anywhere; tokens are held in sessionStorage and are
> discarded when the tab closes.

**Commercial or non-commercial?**

> Non-commercial. A personal project, used by one household. Not distributed,
> not monetised, and there is no intention to do either.

**How many users do you expect?**

> Fewer than ten. Family and occasional guests.

**Is it publicly accessible?**

> The code is public at https://github.com/sjmarais9/hitster and the app is
> served from GitHub Pages, but it is only usable by someone with a Spotify
> Premium account who has been added to the app's allowlist.

**Why do you need extended quota?**

> The import script resolves a curated song list to Spotify track URIs. The pool
> is a few thousand songs, and the development-mode rate limit means resolving
> it takes several days of runs interrupted by multi-hour lockouts. The requests
> are read-only searches, run offline and ahead of play rather than during it,
> and the resolved URIs are cached permanently so each song is looked up once.

## If it is declined

Nothing breaks. The fallbacks are already in place:

- **Canonicity data** comes from Deezer's public API, which needs no key, no
  auth and no approval. See `scripts/harvest-playlists.mjs`.
- **Year verification** can come from MusicBrainz, also keyless.
- **Importing** still works, just slowly. The import checkpoints every 25 songs
  and resumes, so a quota lockout costs time rather than progress.

The only thing genuinely lost is `popularity`, which we had already decided not
to trust — it measures streaming rather than familiarity, which is the whole
reason the playlist approach exists.
