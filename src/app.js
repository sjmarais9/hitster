import { beginLogin, isLoggedIn, logout } from './auth.js';

const signedOut = document.getElementById('signed-out');
const signedIn = document.getElementById('signed-in');
const authError = document.getElementById('auth-error');

function render() {
  const authed = isLoggedIn();
  signedOut.classList.toggle('hidden', authed);
  signedIn.classList.toggle('hidden', !authed);
}

document.getElementById('login').addEventListener('click', async () => {
  try {
    await beginLogin();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  }
});

document.getElementById('logout').addEventListener('click', () => {
  logout();
  render();
});

render();
