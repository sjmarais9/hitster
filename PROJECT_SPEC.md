# Hitster PWA - Project Specification

## What this is

A progressive web app that acts as a digital, effectively unlimited card deck for the music
board game Hitster. All game mechanics (timelines, tokens, scoring, turn order) stay physical on
the table. The app does one job only: draw a random song, play it on Spotify with the title,
artist and year hidden, and reveal those details when the player taps a button.

The motivation is that the physical game ships with a fixed and fairly small card set. This
replaces it with a song pool that can grow indefinitely and be filtered to suit the crowd.

## Owner and environment

- Owner: SJ Marais, GitHub username `sjmarais9`
- Primary device: Android phone, Chrome
- Spotify account: Premium (required by the Web Playback SDK)
- Hosting: GitHub Pages, repo to be named `hitster`, served at
  `https://sjmarais9.github.io/hitster/`

## Spotify app registration (already done)

- App name: Hitster
- Client ID: `0927637b79384a27a4f2e487bc2d4619`
- Client secret: not used. The app uses Authorization Code Flow with PKCE, which is designed for
  public clients and needs no secret. Never introduce one.
- Registered redirect URIs:
  - `http://127.0.0.1:3000/callback` for local development
  - `https://sjmarais9.github.io/hitster/callback` for production
- Enabled APIs: Web API, Web Playback SDK

Note that Spotify no longer accepts `localhost` as a redirect host. Local development must run on
`127.0.0.1:3000` exactly, or auth will fail.

## Architecture

Static site, no backend, no build step unless one becomes necessary. Plain HTML, CSS and
JavaScript is the preferred starting point. Everything is served from GitHub Pages.

### Authentication

Authorization Code Flow with PKCE. Tokens held in memory or `sessionStorage`, with refresh token
handling so a game night does not get interrupted by a token expiring after an hour.

Required scopes:

- `streaming` (Web Playback SDK)
- `user-read-playback-state`
- `user-modify-playback-state`
- `user-read-email` and `user-read-private` (required by the SDK for Premium verification)

### Playback

Primary route is the Web Playback SDK, which creates a Spotify Connect device inside the browser
and plays audio directly on the phone. This keeps everything self-contained and means no other
device shows the track name.

Two known constraints to design around:

1. Mobile browsers block audio that is not triggered by a user gesture. Use the SDK's
   `activateElement()` method tied to an explicit user tap when the app first loads, so subsequent
   playback is permitted.
2. The SDK has historically failed to initialise on some Android Chrome builds with an EME
   keysystem error. Build a fallback path: if the SDK fails to become ready, fall back to the Web
   API's device transfer and play endpoints, targeting the Spotify app installed on the same
   phone. Surface this switch quietly in the UI rather than failing hard.

### Song data

A JSON file bundled in the repo, generated collaboratively rather than scraped. Schema per entry:

```json
{
  "artist": "Artist name",
  "title": "Song title",
  "year": 1984,
  "decade": "1980s",
  "genres": ["rock", "new wave"],
  "spotify_uri": "spotify:track:xxxxxxxxxxxxxxxxxxxxxx",
  "market_checked": "ZA"
}
```

Critical rule on the `year` field: our value is the source of truth and must be the original
release year. Spotify's own release dates frequently reflect remasters, reissues or compilation
albums, and using them would silently break the core mechanic of the game. Never overwrite our
year with Spotify's.

A separate one-off import script takes a batch of generated songs (artist, title, year, genres),
searches the Spotify API for each, attaches the track URI, and writes out anything it could not
match confidently to a review file for manual resolution. Songs without a verified URI must not
enter the playable pool.

Also verify availability in the ZA market, since a track that exists on Spotify but is not
licensed locally will fail to play and spoil a round.

## v1 scope

1. Login with Spotify
2. Draw button: picks a random song from the pool that has not yet been played this session
3. Playback begins with nothing identifying shown on screen
4. Reveal button: displays artist, title and year
5. Next draw
6. Session memory so the same song does not repeat within one game

## Explicitly out of scope for v1

Filtering by decade or genre comes in v2, but the data schema above already carries the fields so
no migration is needed later. Also deferred: scoring, player management, timeline tracking,
multi-device sync, offline play. Do not build these speculatively.

## Design intent

The app is passed around a table in a living room, likely with drinks involved and the lights
down. That drives the interface.

- Large touch targets, usable at arm's length and without careful aim
- Dark theme by default
- The hidden state must be unambiguous. Nobody should ever wonder whether they are looking at a
  spoiler. No album art, no progress bar showing track length, no browser tab title leaking the
  song name
- Reveal should feel like flipping a card, a deliberate and satisfying moment rather than a form
  submission
- Minimal chrome. During a round the screen should show almost nothing except the two buttons

## Repository conventions

- Git from the first commit, with meaningful commit messages
- `README.md` covering local setup, including the `127.0.0.1:3000` requirement
- Song data in `data/songs.json`, import tooling in `scripts/`
- No secrets in the repo at any point. The Client ID is public and may be committed
