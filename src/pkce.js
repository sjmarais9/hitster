// PKCE primitives (RFC 7636). Uses only Web Crypto, which is available on any
// browser that can run the Playback SDK.

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function randomString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // Modulo bias across a 64-character alphabet is negligible here and the
  // verifier only needs to be unguessable for the length of one redirect.
  return Array.from(bytes, (b) => UNRESERVED[b % UNRESERVED.length]).join('');
}

function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Spec allows 43-128 characters; 64 is comfortably inside that.
export function createVerifier() {
  return randomString(64);
}

export function createState() {
  return randomString(16);
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}
