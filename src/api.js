// Thin wrapper over the Spotify Web API. Every call goes through getAccessToken,
// so refreshes are handled in one place rather than at each call site.

import { getAccessToken } from './auth.js?v=f4363e15';

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.spotify.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Playback endpoints answer 204 with no body on success.
  if (response.status === 204 || response.status === 202) return null;

  // Read as text first. Parsing straight to JSON and swallowing the failure
  // discarded the one thing worth having when the body is not JSON at all - a
  // proxy's own error page, say - and left the generic message below standing in
  // for it. That is how a 403 reached a player with nothing to act on.
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* not JSON; `text` still holds it */ }

  if (!response.ok) {
    const err = new Error(describe(method, path, response.status, payload, text));
    err.status = response.status;
    // Spotify's own machine-readable cause, on the player endpoints that send
    // one: PREMIUM_REQUIRED, NO_ACTIVE_DEVICE, UNKNOWN and friends. Worth
    // carrying separately so a caller can branch on it rather than match prose.
    err.reason = payload?.error?.reason ?? null;
    err.body = text;
    throw err;
  }
  return payload;
}

function describe(method, path, status, payload, text) {
  const message = payload?.error?.message;
  const reason = payload?.error?.reason;

  // Spotify's message, plus the reason code when it adds one. Both are useful:
  // the prose is for the person holding the phone, the code is for whoever they
  // send the screenshot to.
  if (message) return reason ? `${message} (${reason})` : message;

  // No message means no usable JSON error, so show a slice of whatever did come
  // back. Truncated, because this lands in a toast on a phone.
  const snippet = text.trim().slice(0, 120);
  const tail = snippet ? ` - ${snippet}` : ' - empty response';
  return `${method} ${path} failed (${status})${tail}`;
}
