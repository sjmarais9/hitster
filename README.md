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

Tokens are kept in `sessionStorage`, so closing the tab ends the session. That is intentional:
the phone gets handed around a table.

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

Three dimensions multiply together:

| Control | What it does | Can it exclude? |
|---|---|---|
| **Familiarity** — three buttons | Sharpens or flattens the preference for well-known songs | Never |
| **Crowd** — a slider, adults to kids | Sets the resulting mix, not just a preference | Only at the exact ends, where the label says so |
| **Genre** — a mixer, one fader each | Raises or lowers a genre family | Only at `Off`, which is labelled |

Only **decade** genuinely filters, because "no 1960s tonight" is a statement
about what the table wants to hear rather than a difficulty setting.

The familiarity weight blends two disagreeing sources: our own `familiarity`
tag, which knows this household but is one person's judgement, and a measured
`canonicity` score, which knows the world but has never met the family.
`TRUST` in `src/scoring.js` decides the balance. At 0.6 local knowledge stays
ahead — a song the family knows but no playlist has heard of still outranks a
global hit they cannot place — while canonicity moves about 6% of songs across a
tier boundary and, more usefully, separates songs the tags treat as identical.

The crowd slider is normalised by population; the genre mixer deliberately is
not. The adults/kids imbalance is an artefact worth correcting. Genre family
sizes are real: 1,064 rock songs against 12 African ones, and normalising would
make a flat mixer give both the same airtime.

## Installing it on the phone

Open the site in Chrome and use **Add to Home Screen**. The manifest asks for
`standalone` display, so it launches without the URL bar or tab strip — which
also removes the last piece of chrome that could show anything about the song.

The icons are generated rather than drawn: `node scripts/make-icons.mjs` writes
`icons/icon-192.png` and `icons/icon-512.png`. Run it only if the design
changes; the output is committed.

While a card is on the table the app holds a screen wake lock, so the phone does
not dim mid-song. It is released automatically whenever the tab is backgrounded.

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

Authentication is PKCE over a loopback server rather than Client Credentials,
specifically so no client secret exists anywhere in this project.

### Checking the data

```sh
node scripts/check-tags.mjs data/batch-006.seed.json   # distribution, rule breaches
node scripts/audit-years.mjs                           # years against MusicBrainz
```

### Tests

```sh
npm test
```

41 tests, no dependencies, no network. They cover the matcher, the filters, the
sampler — asserted over 20,000 seeded draws rather than single picks — and an
end-to-end smoke test that loads the real pool and plays a full session through
`game.js`.
