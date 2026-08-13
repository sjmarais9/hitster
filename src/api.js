// Thin wrapper over the Spotify Web API. Every call goes through getAccessToken,
// so refreshes are handled in one place rather than at each call site.

import { getAccessToken } from './auth.js?v=0e04e0c5';

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

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `${method} ${path} failed (${response.status})`);
  }
  return payload;
}
