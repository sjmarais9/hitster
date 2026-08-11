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
index.html          app shell
callback/           OAuth redirect target
css/                styles
src/                config, PKCE, auth, app
data/               song pool
scripts/            one-off import tooling
```

## Song data

`data/songs.json` is the playable pool. The `year` field is **our** value and is the original
release year — it is the source of truth. Spotify's release dates routinely reflect remasters,
reissues and compilations, and using them would silently break the core mechanic of the game.
Never overwrite our year with Spotify's.

Songs are generated collaboratively into a seed batch, then run through the import script in
`scripts/`, which resolves each track to a Spotify URI and verifies availability in the `ZA`
market. Anything it cannot match confidently goes to a review file for manual resolution. **A
song without a verified URI does not enter the playable pool.**

### Running the import

```sh
node scripts/import-songs.mjs --in data/songs.seed.json --port 3001
```

It opens a browser for a one-off authorisation, resolves each song, then writes:

- `data/songs.json` — the playable pool, confident matches only
- `data/review.json` — everything else, with candidates listed for a human to settle

The port must be registered as a redirect URI in the Spotify dashboard, same as for the app.
`--dry-run` reports without writing, `--limit 5` trials a handful, and `--recheck` re-resolves
songs that already have a URI. Re-running is safe: already-resolved songs are skipped and the
existing pool is merged rather than replaced.

The script authenticates with PKCE over a loopback server rather than Client Credentials,
specifically so that no client secret has to exist anywhere in this project.

### Tests

```sh
npm test
```

Covers the matcher — the logic that decides whether a search result really is the song we asked
for. It has no dependencies and needs no network.
