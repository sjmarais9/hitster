// PKCE from a command line tool.
//
// The same flow the web app uses, with a throwaway loopback server standing in
// for the callback page. This exists so the import script never needs a client
// secret: Authorization Code Flow with PKCE is designed for public clients, and
// a CLI is exactly that. Client Credentials would work too, but would require
// introducing a secret to the project, which the spec forbids outright.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { CLIENT_ID, AUTHORIZE_ENDPOINT, TOKEN_ENDPOINT } from '../../src/config.js';
import { createVerifier, createState, challengeFor } from '../../src/pkce.js';

const DONE_PAGE = `<!doctype html><meta charset="utf-8">
<title>Done</title>
<body style="background:#0d0f14;color:#f2f4f8;font:1.25rem system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>Authorised. Close this tab and go back to the terminal.</p>`;

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // The empty string is the window title; start treats the first quoted
      // argument as one, and eats the URL without it.
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // Non-fatal. The URL is printed regardless.
  }
}

/** Waits for Spotify to redirect back, then resolves with the code. */
function awaitCallback(port, expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
      server.close();

      if (error) reject(new Error(`Spotify refused the login: ${error}`));
      else if (state !== expectedState) reject(new Error('State mismatch. Discarding this login.'));
      else if (!code) reject(new Error('No authorization code came back.'));
      else resolve(code);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${port} is already in use. Pass --port with another registered port, ` +
          `for example: --port 3001`,
        ));
      } else {
        reject(err);
      }
    });

    server.listen(port, '127.0.0.1');
  });
}

async function postToken(body) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Token request failed: ${payload.error_description || payload.error || response.status}`);
  }
  return payload;
}

/**
 * Runs the full flow and returns an authorised `spotify(path)` fetch helper
 * that refreshes itself when the token ages out mid-run.
 */
export async function authorise({ port = 3000 } = {}) {
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const verifier = createVerifier();
  const state = createState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    // Search and track lookup need no scopes at all. Asking for none keeps this
    // tool strictly less privileged than the app.
    scope: '',
  });

  const authUrl = `${AUTHORIZE_ENDPOINT}?${params}`;
  const pending = awaitCallback(port, state);

  console.log(`\nAuthorising via ${redirectUri}`);
  console.log(`If a browser does not open, visit:\n${authUrl}\n`);
  openBrowser(authUrl);

  const code = await pending;
  let tokens = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  let expiresAt = Date.now() + tokens.expires_in * 1000;

  async function token() {
    if (Date.now() < expiresAt - 60_000) return tokens.access_token;
    const refreshed = await postToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    });
    // Spotify does not always return a new refresh token; keep the old one.
    tokens = { ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token };
    expiresAt = Date.now() + tokens.expires_in * 1000;
    return tokens.access_token;
  }

  /** GET a Web API path, retrying once on 429 and honouring Retry-After. */
  return async function spotify(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`https://api.spotify.com/v1/${path}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });

      if (response.status === 429) {
        const wait = Number(response.headers.get('retry-after') || 2);
        console.log(`  rate limited, waiting ${wait}s`);
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`);
      }
      return response.json();
    }
    throw new Error(`GET ${path} failed: still rate limited after retry`);
  };
}
