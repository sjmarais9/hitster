# Hitster

A digital, effectively unlimited card deck for the music board game **Hitster**. All game
mechanics — timelines, tokens, scoring, turn order — stay physical on the table. The app draws a
random song, plays it on Spotify with the title, artist and year hidden, and reveals them when a
player taps Reveal.

Static site, no backend, no build step. Served from GitHub Pages at
<https://sjmarais9.github.io/hitster/>.

Requires a **Spotify Premium** account — the Web Playback SDK will not stream without one.

## Local development

Spotify no longer accepts `localhost` as a redirect host. The dev server must be reachable at
**`127.0.0.1:3000` exactly** or the login will fail with `INVALID_CLIENT: Invalid redirect URI`.
Not `localhost:3000`, not port 8000.

From the repo root:

```sh
python -m http.server 3000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:3000/>. Anything that serves the directory statically on that exact
host and port works just as well, for example:

```sh
npx serve -l tcp://127.0.0.1:3000
```

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
