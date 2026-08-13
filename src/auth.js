// Authorization Code Flow with PKCE against Spotify.
//
// Two stores, holding different things for different reasons.
//
// The access token stays in sessionStorage: per-tab, gone when the tab closes,
// and only ever an hour old anyway. The refresh token goes in localStorage, so
// the session survives the tab being closed, the phone killing the app in the
// background, or opening the site in a fresh tab.
//
// It used to all live in sessionStorage, on the reasoning that a phone being
// passed round a table should not be left holding a live Spotify session. What
// that actually produced was a login prompt every time the app was relaunched -
// which is most times, since Android reaps a backgrounded PWA freely. Being
// asked to log in mid-party is a worse outcome than the one it was avoiding, and
// Log out is still there for anyone who wants the old behaviour on demand.
//
// The trade this makes: localStorage is readable by any script on this origin,
// so a persisted refresh token is exposed to cross-site scripting in a way a
// per-tab one is less so. There are no third-party scripts here beyond
// Spotify's own playback SDK, the token only grants what SCOPES asks for, and
// revoking it is one tap in a Spotify account page. Standard practice for a
// PKCE single-page app, and the right call for this one.
//
// Refreshing is handled transparently so an hour-long game is not interrupted.

import { CLIENT_ID, SCOPES, AUTHORIZE_ENDPOINT, TOKEN_ENDPOINT, redirectUri, basePath } from './config.js?v=105ce954';
import { createVerifier, createState, challengeFor } from './pkce.js?v=105ce954';

// One-shot values for a single login flow. Per-tab is exactly right for these:
// the callback lands in the same tab that started it, and nothing should be
// able to complete a login the tab did not begin.
const VERIFIER_KEY = 'hitster.pkce_verifier';
const STATE_KEY = 'hitster.oauth_state';

const TOKENS_KEY = 'hitster.tokens';    // sessionStorage: the access token
const REFRESH_KEY = 'hitster.refresh';  // localStorage: the long-lived half

// Refresh this far ahead of actual expiry so a request never races the clock.
const REFRESH_MARGIN_MS = 60_000;

function readRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    // Private browsing or a blocked origin. The session simply will not persist.
    return null;
  }
}

/**
 * The access token if this tab has one, always carrying whatever refresh token
 * is on the device - which may be the only half that survived a relaunch.
 */
function readTokens() {
  const refresh_token = readRefreshToken();
  let session = null;
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }

  if (!session) return refresh_token ? { refresh_token, expires_at: 0 } : null;
  return { ...session, refresh_token: session.refresh_token || refresh_token };
}

function writeTokens(tokens) {
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  try {
    if (tokens.refresh_token) localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  } catch {
    // Not fatal: the game still works, it just asks for a login next launch.
  }
}

/**
 * True when a game could be started without a trip to Spotify. A refresh token
 * on its own counts - getAccessToken will redeem it - so a relaunched app goes
 * straight to the start screen rather than the login button.
 */
export function isLoggedIn() {
  return readTokens() !== null;
}

export function logout() {
  sessionStorage.removeItem(TOKENS_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch { /* nothing persisted to begin with */ }
}

/**
 * Step 1. Send the browser to Spotify's consent screen.
 * The verifier stays here; only its SHA-256 hash travels in the URL.
 */
export async function beginLogin() {
  const verifier = createVerifier();
  const state = createState();

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    scope: SCOPES,
  });

  location.assign(`${AUTHORIZE_ENDPOINT}?${params}`);
}

/**
 * Step 2. Runs on the callback page. Validates state, trades the code for
 * tokens using the stored verifier, then hands back to the app root.
 * Throws with a human-readable message if anything is off.
 */
export async function completeLogin() {
  const params = new URLSearchParams(location.search);

  const denied = params.get('error');
  if (denied) throw new Error(`Spotify refused the login: ${denied}`);

  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);

  if (!code) throw new Error('No authorization code came back from Spotify.');
  if (!verifier) throw new Error('This tab did not start the login. Start again from the app.');
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('State mismatch. Discarding this login attempt.');
  }

  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  // One-shot values; leaving them around only creates replay surface.
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  store(tokens);
}

/**
 * Step 3. The only token accessor the rest of the app should use.
 * Refreshes on demand and never returns something already expired.
 */
let inFlightRefresh = null;

export async function getAccessToken() {
  const tokens = readTokens();
  if (!tokens) throw new Error('Not logged in.');

  if (Date.now() < tokens.expires_at - REFRESH_MARGIN_MS) {
    return tokens.access_token;
  }

  // Collapse concurrent callers onto a single refresh. Without this the SDK's
  // token callback and an API call can fire at once, and the second refresh
  // invalidates the first rotated token.
  if (!inFlightRefresh) {
    inFlightRefresh = refresh(tokens.refresh_token).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function refresh(refreshToken) {
  if (!refreshToken) {
    logout();
    throw new Error('Session expired. Log in again.');
  }

  let tokens;
  try {
    tokens = await requestTokens({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    });
  } catch (err) {
    // A rejected refresh token is terminal: nothing to do but log in again.
    logout();
    throw new Error(`Session expired. Log in again. (${err.message})`);
  }

  // Spotify rotates the refresh token, but does not always send a new one.
  // Dropping the old one on a response that omits it would end the session.
  const stored = store({ ...tokens, refresh_token: tokens.refresh_token || refreshToken });
  return stored.access_token;
}

async function requestTokens(body) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error_description || payload.error || response.status;
    throw new Error(`Token request failed: ${detail}`);
  }
  return payload;
}

function store(tokens) {
  const record = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  writeTokens(record);
  return record;
}

export function appUrl() {
  return location.origin + basePath();
}
