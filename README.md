# Hitster

A digital, effectively unlimited card deck for the music board game **Hitster**. All game
mechanics — timelines, tokens, scoring, turn order — stay physical on the table. The app draws a
random song, plays it on Spotify with the title, artist and year hidden, and reveals them when a
player taps Reveal.

Static site, no backend, no build step. Served from GitHub Pages at
<https://sjmarais9.github.io/hitster/>.

Requires a **Spotify Premium** account — the Web Playback SDK will not stream without one.

## Local development

Spotify no longer accepts `localhost` as a redirect host. The dev server must be reachable on
**`127.0.0.1`** — not `localhost` — or the login fails with
`INVALID_CLIENT: Invalid redirect URI`.

The port must be one that is registered in the Spotify dashboard. Two are: **3000** and **3001**.
Use either. 3001 exists because port 3000 is often already taken on this machine.

From the repo root:

```sh
python -m http.server 3001 --bind 127.0.0.1
```

Then open <http://127.0.0.1:3001/>. Anything that serves the directory statically on that host
and a registered port works just as well, for example:

```sh
npx serve -l tcp://127.0.0.1:3001
```

The app reads its redirect URI from `location.origin`, so switching between registered ports
needs no code change. Using an *unregistered* port is the failure mode to watch for — it fails at
the consent screen, before any of our code runs.

### Why the callback is a directory

The registered redirect URIs are `http://127.0.0.1:3000/callback` and
`https://sjmarais9.github.io/hitster/callback`, with no file extension and no trailing slash.
A static host cannot serve a file at that path directly, so the callback lives at
`callback/index.html`. Both GitHub Pages and `http.server` redirect `/callback` to `/callback/`
and carry the query string across, so the authorization code survives the hop.

## Authentication

Authorization Code Flow with PKCE. There is no client secret anywhere in this repo and none
should ever be added — PKCE exists precisely so public clients do not need one. The Client ID is
public and is committed deliberately.

The access token lives in `sessionStorage` and the refresh token in `localStorage`, so a session
survives the tab closing or the phone reaping the app in the background. **Log out** ends it.

That split replaced an earlier rule keeping both per-tab, on the reasoning that a phone handed
round a table should not be left holding a live Spotify session. Android reaps a backgrounded PWA
freely, so what it actually produced was a login prompt on most launches — worse, mid-party, than
the thing it was guarding against. The trade is that a persisted refresh token is exposed to any
script on the origin; there are none here beyond Spotify's own playback SDK, the token grants only
the scopes listed above, and it can be revoked from a Spotify account page.

## Layout

```
index.html              app shell
manifest.webmanifest    installable app metadata
callback/               OAuth redirect target
css/                    styles
src/                    config, PKCE, auth, playback, game, scoring, filters
data/                   song pool and seed batches
icons/                  generated, see scripts/make-icons.mjs
scripts/                tooling: import, generation, canonicity, checks
docs/                   tagging rules, scheduling, decisions taken
```

## How a song gets chosen

Nothing is filtered out for being obscure or grown-up. Everything is
**weighted**, so a song becomes less likely rather than impossible. That matters
because the tags are fallible — four review rounds found correction rates
between 25% and 55% — and a weighted system degrades gracefully where a filter
makes a mis-tagged song vanish from every game.

Four dimensions multiply together:

| Control | What it does | Can it exclude? |
|---|---|---|
| **Familiarity** — a knob, four settings | Sharpens or flattens the preference for well-known songs | Never, at any level |
| **Crowd** — a slider, adults to kids | Sets the resulting mix, not just a preference — and now actually does | Only at the exact ends, where the label says so |
| **Genre** — a mixer, one fader each | Raises or lowers a genre family | Only at `Off`, which is labelled |
| **Decade** — a mixer, one fader each | Raises or lowers an era | Only at `Off`, which is labelled |

Decade is the only one where `Off` removes songs from the deck outright rather
than weighting them to nothing, because the deck count on screen should say how
many songs are really in play. "No 1960s tonight" is a decision made before the
game starts; a muted genre is a dial that can be moved mid-session without the
unplayed set shifting under whoever is holding the phone.

The decade faders show each era's **share of the draw** rather than their own
position, because "1.4×" does not answer the question being asked. That share
moves when the genre mixer and the crowd slider move too, since neither genre
nor age is spread evenly across the eras — so the number is recomputed from the
same weights the draw uses, and a test pins it to what 40,000 draws actually do.

### What the extremes actually do

Worth being precise, because "weighted, not filtered" is easy to state and easy
to quietly break.

**No familiarity level ever excludes a song.** The level sets an exponent `k`
applied to each song's score. What it costs, measured across the pool:

| Level | `k` | Share below canonicity 60 | Share tagged `deep` |
|---|---|---|---|
| Casual | 6 | 6.1% — about one card in 16 | 0.4% |
| Confident | 3 | 15.5% — one in 6 | 4.3% |
| Devoted | 1.5 | 26.6% — one in 4 | 14.2% |
| **Encyclopaedic** | 0.5 | 40.5% — two in five | 29.4% |

Both columns move as the pool grows, so they are measured rather than promised:
`npm test` recomputes them against the songs that actually ship.

The **left-hand measure is canonicity, not the tag**, and that distinction is
the whole reason this table was rewritten. The `deep` share looked healthy at
1.4% right through a Casual night that played visibly harder than "mostly songs
everyone knows" claims. What was being dealt was the middle tier: songs still
tagged `familiar` whose measured canonicity had fallen away underneath them as
the pool grew. A number watching the tag agreed with itself all the way through.

**The whole ladder was retuned on 29 August 2026**, and every rung moved. The
old `k` values were fitted when the pool held 1,649 songs, nearly all chosen by
hand. It now holds 9,430, 85% of them from a playlist index, and the same
exponent against a corpus that much broader is a different game — Casual had
drifted to 12.3% below canonicity 60, roughly three cards a night nobody could
place.

**Encyclopaedic is no longer perfectly flat.** `k=0` said the app makes no
judgement at all, which was an honest claim on a curated pool and an unplayable
one at 9,430 songs: it dealt 56% of the night below canonicity 60, four cards in
seven that nobody can place. That is not a harder game but a different and worse
one. `k=0.5` still reaches the whole pool and still favours almost nothing, and
the label now says what it deals rather than making the stronger claim.

At Casual the most obscure possible song is many thousands of times less likely
than a perfect standard — you would probably never see it in a night, but the
weight stays positive, which is the whole point. The tags are wrong often enough
that a mis-tagged song must not vanish from every game forever.

**Devoted was added because the original three were not evenly spaced**, and the
gap was not in the middle: Casual to Confident was the difference between two
kinds of rare, while Confident to Encyclopaedic was where a night changed
character. A test holds every neighbouring pair to at least half as much again
*on the shipped pool*, so a fifth level cannot be added without earning its place
— and the guarantee cannot quietly stop being true, as an earlier one did while
its test went on passing against a deck of its own.

The **crowd slider** zeroes the opposite side only at *exactly* 0 or 1. Its step
is 0.05 and the label reads "Adults only" from 0.05 down, so one notch off the
end still says Adults only while leaving a kids-tagged song possible. Songs
tagged `even` are never excluded at either end, since they carry half weight on
both sides.

**A deck where nothing is eligible refuses to deal, and says so.** It used to
fall back to a uniform draw over everything, on the reasoning that dealing
something beats dealing nothing — but what that actually did was deal the songs
you had just switched off, while their labels read `Off` and the share readout
said 0%.

It did not need all nine faders down to happen, either. One decade plus four
muted genres leaves a thirteen-song deck with no weight at all, and 9,238 of
10,000 draws came from families set to `Off`. Now the game stops and tells you
which control to turn back up.

The familiarity weight blends two disagreeing sources: our own `familiarity`
tag, which knows this household but is one person's judgement, and a measured
`canonicity` score, which knows the world but has never met the family.
`TRUST` in `src/scoring.js` decides the balance. At 0.6 local knowledge stays
ahead — a song the family knows but no playlist has heard of still outranks a
global hit they cannot place — while canonicity moves about 6% of songs across a
tier boundary and, more usefully, separates songs the tags treat as identical.

The crowd slider normalises by the weight each side actually carries, **after**
familiarity, genre and decade have had their say. Normalising by song count and
multiplying afterwards looks equivalent and is not: those factors correlate with
skew — the children's songs are recent and well known, the adults' side holds
the deep cuts — so favouring familiar music silently favoured the children too.
On the real pool, "Balanced" at Casual gave them 67% of the night. Ordering it
this way makes the slider mean what it says at every level, which a test now
holds it to on a deck built to expose exactly that interaction.

Both mixers deliberately are not normalised.
The adults/kids imbalance is an artefact worth correcting. Genre family sizes
are real — rock outnumbers African by about a hundred to one — and so are decade
sizes, where the 1950s holds a handful. Normalising either would give a flat
mixer the job of handing those few an eighth of the night.

Run `node scripts/stats.mjs` for the current counts, which reports the playable
pool and the import queue separately rather than summing them.

## Installing it on the phone

Open the site in Chrome and use **Add to Home Screen**. The manifest asks for
`standalone` display, so it launches without the URL bar or tab strip — which
also removes the last piece of chrome that could show anything about the song.

The icons are generated rather than drawn: `node scripts/make-icons.mjs` writes
`icons/icon-192.png` and `icons/icon-512.png`. Run it only if the design
changes; the output is committed.

While a card is on the table the app holds a screen wake lock, so the phone does
not dim mid-song. It is released automatically whenever the tab is backgrounded.

### Why deploys need a version stamp

GitHub Pages serves everything with `Cache-Control: max-age=600` and gives no
way to change that. Nothing here was versioned, so a phone with the app on its
home screen kept running the old CSS and the old modules — a push would land and
simply not appear.

Worse than merely stale: each ES module is cached independently and expires at
its own moment, so the app could end up running a new `app.js` against an old
`scoring.js`, a combination that was never tested and need not work at all.

So every asset URL carries `?v=<hash>`, where the hash covers `src/`, `css/` and
both HTML files. `index.html` is still cached for up to ten minutes, but once it
is refetched, everything it points at is refetched *with* it, as a matched set.

```
npm run stamp     rewrite the stamps
npm test          fails if anything is unstamped
```

`.githooks/pre-commit` runs the stamp automatically and re-stages whatever it
touched, so this is not something to remember. Enable it once per clone:

```
git config core.hooksPath .githooks
```

The stamp is a hash of the source rather than a timestamp, so an unchanged tree
restamps to the same value and the hook stays a no-op until code actually
changes. No service worker: those address this problem by taking on a harder
version of it.

**If a phone is still showing an old build**, it is holding an `index.html` from
within the last ten minutes. Pull down to refresh in Chrome, or open the site in
a tab (rather than from the home screen icon) and reload — the stamps do the
rest.

## Sharing it

The site is public — anyone can open it. What is not public is Spotify access,
and that is what decides which of these three cases applies.

**Playing with the owner needs nothing.** The game runs on the owner's account,
on the owner's phone, passed around the table exactly as the physical game is.
Nobody else logs in, and nobody else needs Premium. This is what the app was
built for and it already works.

**A friend hosting their own game night needs two things:**

1. **Spotify Premium.** The Web Playback SDK will not stream without it, and
   there is no way around that inside Spotify.
2. **A place on this app's allowlist.** The app is in development mode, so only
   accounts added by hand can use it. Add them in the
   [dashboard](https://developer.spotify.com/dashboard) under **Settings → User
   Management**, using the email on their Spotify account — not necessarily the
   address they message you from, and it has to match exactly.

**Spotify does not enforce that allowlist at the consent screen.** This is worth
knowing before it costs an evening. An unregistered account authorises cleanly
and receives a working token; it is refused only when it first calls the Web API,
and refused with a 403 whose body is plain text rather than Spotify's usual JSON
error — so anything parsing for JSON finds nothing to report.

Nothing before Play touches the Web API. The login is Spotify's own, the deck is
local, and the pool is a file in this repo. So the refusal surfaced at the first
tap of Play, in front of everyone, reading `PUT me/player/play failed (403)` and
nothing else — indistinguishable from a Premium problem, a dead device or a bad
network, and it took several rounds of guessing to tell apart. `connect()` now
makes one `GET me` before the SDK loads, which moves the refusal to the start
screen and names it: *You're not on this app's allowlist, ask the owner to add
you.*

Development mode caps how many users can be listed. **The dashboard's User
Management page is the authority on that number**; it has changed more than once
and is worth reading rather than assuming. `docs/spotify-quota-request.md`
records it as five, from research at the time. Extended quota would lift the cap
and is permanently closed to us — same doc explains why.

**A friend who wants their own copy** forks the repo and runs it as their own
app, which sidesteps this app's cap entirely by using their own. Two changes:

- `CLIENT_ID` in `src/config.js`, set to their own Spotify app
- Their redirect URI registered in their dashboard, as
  `https://<user>.github.io/<repo>/callback`

`basePath()` derives from `location`, so nothing else needs touching. The song
pool travels with the repo, which is the part that took weeks — but it travels
as a snapshot, and later work here will not reach them unless they pull.

## Song data

`data/songs.json` is the playable pool. Batches live alongside it as
`data/batch-NNN.seed.json` and hold songs waiting to be resolved.

**`year` is ours and is the original release year.** Spotify's release dates
routinely reflect remasters, reissues and compilations, and using them would
silently break the core mechanic. Never overwrite our year with Spotify's. The
only field in the pool that belongs to Spotify is `album`, which is descriptive
and often names a reissue.

**A song without a verified URI does not enter the playable pool.**

### Where songs come from

Two ways, and the second is now preferred.

**Written by hand** — batches 002 to 005. Slow, and it makes every year depend
on one person's recall, which is the largest correctness risk here.

**Generated from data** — batch 006 onward, via
`scripts/generate-from-index.mjs`. Artist and title come from a playlist index;
`year` from MusicBrainz release-groups; genre from the themes a song appears
under; `familiarity` and `skew` are seeded from canonicity and year.

The generator's years are accepted only where MusicBrainz agrees with the decade
that the song's playlists place it in. MusicBrainz alone tested at 84% exact,
which is not good enough for the one field that breaks the game when wrong, so
disagreements are discarded rather than guessed at. There are far more
candidates than the pool needs, which makes rejection cheap.

### The canonicity signals

`canonicity` is a 0–100 within-decade percentile, averaged across two unrelated
sources. Both agree with our hand tags and with each other:

| Source | What it measures | Coverage | standard / familiar / deep |
|---|---|---|---|
| Deezer playlists | how many curated lists include the track | 91% | 92 / 67 / 34 |
| Last.fm listeners | how many distinct people have heard it | 99.9% | 86 / 66 / 36 |

Within decade, always — a 1967 song and a 2015 song face completely different
playlist populations, and comparing raw counts measures the platform rather than
the song.

Neither source knows South African music. Vulindlela appears on **zero**
playlists despite eight South African harvest themes. That is why local tags win
at `TRUST = 0.6`, and no external source will ever fix it.

`TRUST` is worth its 0.6 only for a tag a person actually chose. **batch-006 was
generated, so its `familiarity` is a function of its canonicity** — the two are
one signal wearing two hats, and `scoreOf` blends them believing otherwise. That
is harmless while they agree, and they stopped: canonicity is a percentile over
the whole corpus, so every import re-ranked it, and 3,400 seeded tags were left
asserting a popularity their own score no longer supported.

`apply-canonicity.mjs` now re-derives the seeded tags whenever it re-ranks, and
never touches one the household has ruled on — a seeded song can be reviewed
later, and at that moment the tag stops being the generator's to move. A test in
`data.test.mjs` asserts no seeded tag has drifted, because the failure is silent
by nature: every value involved is a legal one.

```sh
node scripts/harvest-playlists.mjs    # build the playlist index (~40 min)
node scripts/fetch-lastfm.mjs         # listener counts, needs LASTFM_API_KEY
node scripts/apply-canonicity.mjs     # write the score onto every song
node scripts/score-canonicity.mjs     # validate it against our tags
```

### Running the import

Normally you do not — it runs itself every four hours. See
[docs/scheduled-import.md](docs/scheduled-import.md).

```sh
node scripts/import-daily.mjs                              # all batches, oldest first
node scripts/import-songs.mjs --in data/batch-003.seed.json --port 3001
```

The first run opens a browser; the refresh token is then cached in
`.spotify-token.json` and no run afterwards needs one. Progress checkpoints
every 25 songs, so a run stopped by the quota keeps everything and resumes.

Spotify's daily quota allows roughly 400 songs per lockout cycle, and the cycle
is longer than a day. A large backlog takes weeks. Extended quota is **not
available** — see [docs/spotify-quota-request.md](docs/spotify-quota-request.md).

**The import declines anything below canonicity 45** (`--min-canonicity`, and
`0` restores the old behaviour). 45 is where `familiarityFor` stops calling a
song `familiar` and starts calling it `deep`, so the import brings in what the
sampler would go on to treat as known and declines what it would bury.

The floor is there because quota is the scarce thing. What remained of batch-006
was 1,445 songs with a median canonicity of 24, and the queue is sorted
best-first — so everything worth having had already landed, and weeks of daily
quota would have bought nothing but songs the deck is built to avoid dealing.
1,300 of those are now skipped and 145 still imported.

**More familiar songs come from the generator, not the backlog.** Deezer's
playlists carry whichever pressing a curator happened to add, so the index holds
`Should I Stay or Should I Go (Remastered)` rather than the song. The junk filter
read those as junk — they are not; a remaster of a famous single is the famous
single — and because it filters before the reject cache, they were never even
recorded as tried. `cleanTitle` now strips the version suffix before the junk
test, which takes the available candidate pool from 32 to 1,577: *Space Oddity*,
*Streets of Philadelphia*, *Ain't Nobody*, *Karma Chameleon*. A parenthetical
that is part of the song — `(feat. …)`, `Gypsy Woman (She's Homeless)` — is left
alone, and a genuine karaoke recording is still refused.

Authentication is PKCE over a loopback server rather than Client Credentials,
specifically so no client secret exists anywhere in this project.

### Checking the data

```sh
node scripts/check-tags.mjs data/batch-006.seed.json   # distribution, rule breaches
node scripts/audit-years.mjs                           # years against MusicBrainz
node scripts/recheck-pool-years.mjs                    # two-source year check over the pool
```

### How a wrong year gets caught

`year` is the field that breaks the game, and no single source can be trusted
with it. Both of the ones available are wrong in their own direction:

| Source | Drifts | Measured |
|---|---|---|
| Spotify release dates | **late**, towards remasters and reissues | raised 9 suspects in 665 songs, 6 real |
| MusicBrainz recordings | **late** before 1990, where its earliest entry is a CD reissue | disagreed with 21% of batch 006, mostly its own error |

So neither votes alone. A year is only corrected when **both land on the same
earlier year**, which two independent catalogues with unrelated failure modes do
not do by accident. Replayed over the nine suspects of 16 August that rule made
four corrections, all four right, and none of the three where our year was
already correct — including Dinosaur Jr.'s *Just Like Heaven*, where Spotify
finds The Cure's 1987 original and MusicBrainz, filtering on an exact artist,
stays on the 1989 cover.

The rule lives in `scripts/lib/year-check.mjs`. `import-songs.mjs` applies it as
each song lands, reading MusicBrainz's answers from `data/musicbrainz-years.json`
rather than over the network — a six-hour sweep already paid for, and MusicBrainz
does not revise a 1978 release date. Suspects land in the batch review file
ranked `confirmed`, `check`, `contradicted`.

**Nothing is corrected automatically.** A `confirmed` verdict is a strong
recommendation, applied by a dated script the way `apply-year-fixes-2026-08-16.mjs`
applied the first six. Years established that way are pinned in
`lib/reviewed.mjs` as `VERIFIED_YEARS`, because re-running the generator would
put every one of them back and nothing in the data would look wrong.

The pool re-check costs roughly one song of import backlog per song it checks —
`search` and `tracks/{id}` share the daily quota, which a fifteen-request test
was too small to reveal. It checkpoints every 250 and resumes.

### Tests

```sh
npm test
```

138 tests, no dependencies, no network. They cover the matcher, the filters, the
sampler — asserted over 20,000 seeded draws rather than single picks — and an
end-to-end smoke test that loads the real pool and plays a full session through
`game.js`.
