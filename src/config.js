// Public configuration. The Client ID is not a secret and is safe to commit.
// There is no client secret in this app by design: Authorization Code Flow with
// PKCE is built for public clients. Never add one.

export const CLIENT_ID = '0927637b79384a27a4f2e487bc2d4619';

export const SCOPES = [
  'streaming',                  // Web Playback SDK
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-email',            // SDK requires these two to verify Premium
  'user-read-private',
].join(' ');

export const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
export const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

export const MARKET = 'ZA';

// The app has to work from two different roots without a build step:
//   local dev      http://127.0.0.1:3000/
//   GitHub Pages   https://sjmarais9.github.io/hitster/
// Derive the root from wherever this page happens to be served.
export function basePath() {
  const path = location.pathname;
  const callbackAt = path.indexOf('/callback');
  const dir = callbackAt === -1
    ? path.replace(/[^/]*$/, '')   // strip the filename, keep the directory
    : path.slice(0, callbackAt + 1);
  return dir.endsWith('/') ? dir : dir + '/';
}

// Must match a registered redirect URI byte for byte, so no trailing slash here.
export function redirectUri() {
  return location.origin + basePath() + 'callback';
}
