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

import { api } from './api.js?v=105ce954';
import { getAccessToken } from './auth.js?v=105ce954';

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
    player.addListener('account_error', () => settle(reject, new Error('Spotify Premium is required')));

    player.connect().then((ok) => {
      if (!ok) settle(reject, new Error('the SDK refused to connect'));
    });
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

/**
 * Connects the best available route.
 * `onFallback` is called with a reason if the SDK route is unavailable.
 */
export async function connect({ onFallback }) {
  let route;
  try {
    route = await connectSdk();
  } catch (err) {
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
      await api(`me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: { uris: [uri] },
      });
    },
  };
}
