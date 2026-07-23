/* ===== Firebase Auth Module ===== */
/* Uses Firebase v12 modular SDK via CDN */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, sendPasswordResetEmail, deleteUser, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWbQt4aUEUUsA6rZ-dvWuFwKlNA4ozpb4",
  authDomain: "smart-team-tracker.firebaseapp.com",
  projectId: "smart-team-tracker",
  storageBucket: "smart-team-tracker.firebasestorage.app",
  messagingSenderId: "487229821168",
  appId: "1:487229821168:web:5dd5b31af2b0356f44b235",
  measurementId: "G-C65VNG35CB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/* ===== Auth State ===== */
// Guest sessions persist across reloads: without this flag, every cold load
// mid-game dropped guests onto the marketing page (looks like data loss rink-side).
const GUEST_MODE_KEY = 'team-tracker-guest-mode';
let currentUser = null;
let authReadyResolve;
const authReady = new Promise(r => { authReadyResolve = r; });

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authReadyResolve();

  // Skip auth UI when in spectator mode – spectators don't need to log in
  if (window.__spectatorMode) return;

  if (user) {
    hideAuthScreen();
    if (typeof window.onAuthReady === 'function') window.onAuthReady(user);
  } else if (localStorage.getItem(GUEST_MODE_KEY) === '1') {
    // Returning guest: straight into the app, never through the landing page.
    hideAuthScreen();
    if (typeof window.onAuthReady === 'function') window.onAuthReady(null);
  } else {
    showAuthScreen();
  }
});

// Fail-safe: onAuthStateChanged should always fire, but if it somehow does not,
// don't strand the user on the boot splash — fall open to the landing page.
setTimeout(() => {
  const s = document.getElementById('bootSplash');
  if (s && s.style.display !== 'none' && !window.__spectatorMode) {
    showLandingPage();
  }
}, 5000);

/* ===== UI ===== */
function hideBootSplash() {
  const s = document.getElementById('bootSplash');
  if (s) s.style.display = 'none';
}

function showLandingPage() {
  hideBootSplash();
  const landing = document.getElementById('landingPage');
  const auth = document.getElementById('authScreen');
  const app = document.getElementById('appShell');
  if (landing) landing.style.display = '';
  if (auth) auth.style.display = 'none';
  if (app) app.style.display = 'none';
}

function showAuthForm() {
  hideBootSplash();
  const landing = document.getElementById('landingPage');
  const auth = document.getElementById('authScreen');
  const app = document.getElementById('appShell');
  if (landing) landing.style.display = 'none';
  if (auth) auth.style.display = 'flex';
  if (app) app.style.display = 'none';
}

function handleLandingGetStarted() {
  // Straight to the sign-up / guest choice. The first-run welcome modal now
  // fires on first entry INTO the app (see onAuthReady in app.js), not here, so
  // tapping the CTA is never interrupted by onboarding before the user has even
  // chosen to enter.
  showAuthForm();
}

function showAuthScreen() {
  // For unauthenticated users: show landing page (not auth form directly)
  showLandingPage();
}

function hideAuthScreen() {
  hideBootSplash();
  const landing = document.getElementById('landingPage');
  const el = document.getElementById('authScreen');
  const app = document.getElementById('appShell');
  if (landing) landing.style.display = 'none';
  if (el) el.style.display = 'none';
  if (app) app.style.display = '';
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) el.style.display = 'none';
}

/* ===== Actions ===== */
async function handleEmailAuth(e) {
  e.preventDefault();
  clearAuthError();

  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  const mode = document.getElementById('authToggle').dataset.mode;

  if (!email || !pass) {
    showAuthError('Email and password are required.');
    return;
  }
  if (pass.length < 6) {
    showAuthError('Password must be at least 6 characters.');
    return;
  }
  if (mode === 'signup') {
    const confirmEl = document.getElementById('authPassConfirm');
    const confirmVal = confirmEl ? confirmEl.value : '';
    if (pass !== confirmVal) {
      showAuthError('Passwords do not match.');
      return;
    }
  }

  try {
    if (mode === 'signup') {
      await createUserWithEmailAndPassword(auth, email, pass);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (err) {
    const msg = err.code === 'auth/user-not-found' ? 'No account with that email. Try signing up.'
      : err.code === 'auth/wrong-password' ? 'Wrong password.'
      : err.code === 'auth/invalid-credential' ? 'Invalid email or password.'
      : err.code === 'auth/email-already-in-use' ? 'An account with that email already exists. Try signing in.'
      : err.code === 'auth/weak-password' ? 'Password must be at least 6 characters.'
      : err.code === 'auth/invalid-email' ? 'Invalid email address.'
      : err.message || 'Authentication failed.';
    showAuthError(msg);
  }
}

async function handleGoogleAuth() {
  clearAuthError();
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAuthError(err.message || 'Google sign-in failed.');
    }
  }
}

async function handlePasswordReset() {
  clearAuthError();
  const email = document.getElementById('authEmail').value.trim();
  if (!email) {
    showAuthError('Enter your email address, then tap "Reset Password".');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthError('');
    const el = document.getElementById('authError');
    if (el) {
      el.textContent = 'Check your email for a password reset link.';
      el.style.display = 'block';
      el.style.color = 'var(--win)';
      setTimeout(() => { el.style.color = ''; }, 5000);
    }
  } catch (err) {
    const msg = err.code === 'auth/user-not-found' ? 'No account with that email.'
      : err.code === 'auth/invalid-email' ? 'Invalid email address.'
      : err.message || 'Could not send reset email.';
    showAuthError(msg);
  }
}

async function handleSignOut() {
  try {
    const ask = typeof window.showAppConfirm === 'function'
      ? window.showAppConfirm('Sign out now?')
      : Promise.resolve(window.confirm('Sign out now?'));
    const ok = await ask;
    if (!ok) return;
    localStorage.removeItem(GUEST_MODE_KEY);
    if (!currentUser) {
      // Guest "sign out": no Firebase state to change, so show the landing
      // page directly (onAuthStateChanged won't re-fire).
      showLandingPage();
      return;
    }
    await signOut(auth);
  } catch (err) {
    console.error('Sign out error:', err);
  }
}

// Which provider this account signed in with ('google.com' or 'password').
function authProviderId() {
  const p = currentUser && currentUser.providerData && currentUser.providerData[0];
  return p ? p.providerId : '';
}
window.getAuthProviderId = authProviderId;

// Firebase refuses destructive actions on a stale sign-in. Google accounts can
// re-authenticate through a popup with no extra UI; email accounts need the
// password, which the caller supplies.
async function reauthenticateUser(password) {
  if (!currentUser) return { ok: false, code: 'no-user' };
  try {
    if (authProviderId() === 'google.com') {
      await reauthenticateWithPopup(currentUser, googleProvider);
    } else {
      if (!password) return { ok: false, code: 'need-password' };
      await reauthenticateWithCredential(
        currentUser,
        EmailAuthProvider.credential(currentUser.email, password)
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code || 'unknown', message: err.message || '' };
  }
}
window.reauthenticateUser = reauthenticateUser;

// Delete the signed-in Firebase account itself. Firebase requires a recent
// sign-in for this, so report that case distinctly: the caller deletes the
// login BEFORE any data, so a failure here leaves everything intact and the
// user can re-authenticate and retry cleanly.
async function deleteAuthAccount() {
  if (!currentUser) return { ok: false, code: 'no-user' };
  try {
    await deleteUser(currentUser);
    localStorage.removeItem(GUEST_MODE_KEY);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code || 'unknown', message: err.message || '' };
  }
}
window.deleteAuthAccount = deleteAuthAccount;

/* ===== Wire up UI when DOM is ready ===== */
function initAuthUI() {
  const form = document.getElementById('authForm');
  if (form) form.addEventListener('submit', handleEmailAuth);

  const googleBtn = document.getElementById('authGoogleBtn');
  if (googleBtn) googleBtn.addEventListener('click', handleGoogleAuth);

  const resetBtn = document.getElementById('authResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', handlePasswordReset);

  const toggle = document.getElementById('authToggle');
  if (toggle) {
    toggle.dataset.mode = 'login';
    toggle.addEventListener('click', () => {
      const isLogin = toggle.dataset.mode === 'login';
      const nowSignup = isLogin; // toggling from login -> signup
      toggle.dataset.mode = isLogin ? 'signup' : 'login';
      toggle.textContent = isLogin ? 'Already have an account? Sign in' : "Don't have an account? Sign up";
      document.getElementById('authSubmitBtn').textContent = isLogin ? 'Sign Up' : 'Sign In';
      // The confirm-password field only exists in signup mode.
      const confirm = document.getElementById('authPassConfirm');
      if (confirm) {
        confirm.style.display = nowSignup ? '' : 'none';
        if (!nowSignup) confirm.value = '';
      }
      clearAuthError();
    });
  }

  const signOutBtn = document.getElementById('btnSignOut');
  if (signOutBtn) signOutBtn.addEventListener('click', handleSignOut);

  const guestBtn = document.getElementById('authGuestBtn');
  if (guestBtn) {
    guestBtn.addEventListener('click', () => {
      // Guest mode: hide auth screen, but currentUser stays null
      // Data will only be stored locally
      localStorage.setItem(GUEST_MODE_KEY, '1');
      hideAuthScreen();
      if (typeof window.onAuthReady === 'function') window.onAuthReady(null);
    });
  }

  // Landing page → Auth screen transitions
  const landingCta1 = document.getElementById('landingGetStarted');
  const landingCta2 = document.getElementById('landingGetStarted2');
  if (landingCta1) landingCta1.addEventListener('click', handleLandingGetStarted);
  if (landingCta2) landingCta2.addEventListener('click', handleLandingGetStarted);

  // Auth screen → Back to landing
  const backLink = document.getElementById('authBackToLanding');
  if (backLink) backLink.addEventListener('click', showLandingPage);
}

document.addEventListener('DOMContentLoaded', initAuthUI);

/* ===== Bridge to non-module scripts via window globals ===== */
window.getAuthUser = () => currentUser;
window.getAuthUserId = () => currentUser ? currentUser.uid : null;
window.getAuthToken = async () => {
  if (!currentUser) return null;
  try { return await currentUser.getIdToken(); } catch (_) { return null; }
};
window.authSignOut = handleSignOut;

/* ===== Exports ===== */
export { auth, currentUser, authReady, handleSignOut };
export function getUser() { return currentUser; }
export function getUserId() { return currentUser ? currentUser.uid : null; }
