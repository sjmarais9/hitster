// Authorization Code Flow with PKCE against Spotify.
//
// Tokens live in sessionStorage, which is per-tab and cleared when the tab
// closes. That is deliberate: the phone gets passed around a table, and a game
// night should not leave a live Spotify session behind on the device.
// Refreshing is handled transparently so an hour-long game is not interrupted.

import { CLIENT_ID, SCOPES, AUTHORIZE_ENDPOINT, TOKEN_ENDPOINT, redirectUri, basePath } from './config.js?v=bf94c849';
import { createVerifier, createState, challengeFor } from './pkce.js?v=bf94c849';

const VERIFIER_KEY = 'hitster.pkce_verifier';
const STATE_KEY = 'hitster.oauth_state';
const TOKENS_KEY = 'hitster.tokens';

// Refresh this far ahead of actual expiry so a request never races the clock.
const REFRESH_MARGIN_MS = 60_000;

function readTokens() {
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function isLoggedIn() {
  return readTokens() !== null;
}

export function logout() {
  sessionStorage.removeItem(TOKENS_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
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
