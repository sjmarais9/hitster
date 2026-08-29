// Playback, with two routes to the same outcome.
//
// Primary: the Web Playback SDK, which makes this browser a Spotify Connect
// device and plays audio here. Preferred because nothing else in the room
// displays the track name.
//
// Fallback: the Spotify app already installed on this phone, driven remotely
// through the Web API. The SDK has historically failed to initialise on some
// Android Chrome builds with an EME keysystem error, and failing hard mid-game
// is not acceptable. The switch is reported quietly rather than thrown.
//
// Both routes end up calling the same Web API play endpoint with a device_id,
// so only the device differs.

import { api } from './api.js?v=50c36341';
import { getAccessToken } from './auth.js?v=50c36341';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

// If the SDK has not signalled ready by now it is not going to. Long enough for
// a slow phone on bad wifi, short enough not to strand someone at a table.
const READY_TIMEOUT_MS = 12_000;

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();

    // The SDK calls this global when it finishes loading.
    window.onSpotifyWebPlaybackSDKReady = resolve;

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onerror = () => reject(new Error('the SDK script could not be loaded'));
    document.head.append(script);

    setTimeout(() => reject(new Error('the SDK script did not load in time')), READY_TIMEOUT_MS);
  });
}

async function connectSdk() {
  await loadSdk();

  const player = new Spotify.Player({
    name: 'Hitster',
    getOAuthToken: (callback) => { getAccessToken().then(callback, () => {}); },
    volume: 0.8,
  });

  const deviceId = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the SDK never became ready')),
      READY_TIMEOUT_MS,
    );
    const settle = (fn, value) => { clearTimeout(timer); fn(value); };

    player.addListener('ready', ({ device_id }) => settle(resolve, device_id));
    player.addListener('initialization_error', ({ message }) => settle(reject, new Error(message)));
    player.addListener('authentication_error', ({ message }) => settle(reject, new Error(message)));
    // Not a browser problem and the fallback will not help, so say so plainly.
    // The flag carries that distinction out to connect(), which used to discard
    // it and offer a fallback that could only fail the same way.
    player.addListener('account_error', () => {
      const err = new Error('Spotify Premium is required');
      err.fatal = true;
      settle(reject, err);
    });

    // A rejecting connect() left this promise to the twelve-second timeout, and
    // an unhandled rejection on the way there.
    player.connect().then(
      (ok) => { if (!ok) settle(reject, new Error('the SDK refused to connect')); },
      (err) => settle(reject, new Error(err?.message ?? 'the SDK could not connect')),
    );
  });

  return {
    mode: 'sdk',
    deviceId,
    // Mobile browsers only permit audio that follows a user gesture. Calling
    // this inside the first tap buys permission for every later play.
    activate: () => player.activateElement(),
    pause: () => player.pause(),
    resume: () => player.resume(),
  };
}

function remoteControl() {
  let transferred = false;

  return {
    mode: 'remote',
    async deviceIdFor() {
      const { devices } = await api('me/player/devices');
      const device = devices.find((d) => d.is_active)
        ?? devices.find((d) => !d.is_restricted)
        ?? devices[0];

      if (!device) {
        throw new Error('No Spotify device found. Open the Spotify app on this phone, play anything for a second, then draw again.');
      }

      // A cold Spotify app sometimes ignores a play aimed straight at it.
      // Transferring once first is what the SDK route gets for free.
      if (!transferred) {
        await api('me/player', { method: 'PUT', body: { device_ids: [device.id], play: false } });
        transferred = true;
      }
      return device.id;
    },
    activate: () => {},
    // No device_id needed: the transfer above made this the active device, and
    // resume without a body picks up the current track where it stopped.
    pause: () => api('me/player/pause', { method: 'PUT' }),
    resume: () => api('me/player/play', { method: 'PUT' }),
  };
}

// One GET against the Web API before anything else touches it, for two reasons.
//
// It settles Premium honestly. The SDK's `account_error` was carrying that job
// alone and does not always fire - a free account can be handed a device_id,
// look connected, and fail only on the first tap of Play, which is the worst
// possible moment and the least legible error. `product` is not a guess.
//
// It also moves the allowlist check to the front door. This app is in
// development mode, and Spotify does not enforce that at the consent screen: an
// account that is not registered authorises cleanly, receives a working token,
// and is refused only when it first calls the Web API. Nothing before Play does,
// so a friend could log in, tune the deck, sit down with everyone, and discover
// at the first tap that he was never able to play anything.
async function checkAccount() {
  let me;
  try {
    me = await api('me');
  } catch (err) {
    // Spotify's wording is "The user is not registered for this application.
    // Please check your settings on developer.spotify.com" - accurate, addressed
    // to the developer, and no use at all to the person holding the phone, who
    // has no dashboard to check. With the scopes we ask for there is no other
    // realistic 403 on `me`, so say the thing they can act on.
    //
    // It arrives as a plain-text body rather than Spotify's usual JSON error,
    // which is how it stayed hidden for so long: api.js parsed for JSON, found
    // none, and fell back to reporting the status by itself.
    if (err.status === 403) {
      const refused = new Error("You're not on this app's allowlist, ask the owner to add you.");
      refused.fatal = true;
      throw refused;
    }
    err.fatal = true;   // The fallback route is no more reachable than this was.
    throw err;
  }

  if (me?.product !== 'premium') {
    const err = new Error(`Spotify Premium is required (this account is "${me?.product ?? 'unknown'}")`);
    err.fatal = true;
    throw err;
  }
}

/**
 * Connects the best available route.
 * `onFallback` is called with a reason if the SDK route is unavailable.
 */
export async function connect({ onFallback }) {
  await checkAccount();

  let route;
  try {
    route = await connectSdk();
  } catch (err) {
    // Some failures the fallback cannot help with. Without Premium neither
    // route can play anything, and offering "playing through the Spotify app
    // instead (Spotify Premium is required)" is both nonsense and a promise
    // that will 403 on the first tap. Rethrowing lets boot() show the real
    // reason and stop, rather than enabling a Start button that cannot work.
    if (err.fatal) throw err;
    onFallback?.(err.message);
    route = remoteControl();
  }

  return {
    get mode() { return route.mode; },
    activate: () => route.activate(),
    pause: () => route.pause(),
    resume: () => route.resume(),

    async play(uri) {
      const deviceId = route.deviceId ?? await route.deviceIdFor();
      try {
        await api(`me/player/play?device_id=${deviceId}`, {
          method: 'PUT',
          body: { uris: [uri] },
        });
      } catch (err) {
        // Which route produced this is the first thing anyone debugging it asks,
        // and a screenshot of the toast is usually all they get. The two routes
        // fail for different reasons - a dead SDK device and an unreachable
        // phone app look identical without it.
        err.message = `${err.message} [${route.mode}]`;
        throw err;
      }
    },
  };
}
