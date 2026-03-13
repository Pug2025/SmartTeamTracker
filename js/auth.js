/* ===== Firebase Auth Module ===== */
/* Uses Firebase v12 modular SDK via CDN */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, sendPasswordResetEmail, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

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
  } else {
    showAuthScreen();
  }
});

/* ===== UI ===== */
function showLandingPage() {
  const landing = document.getElementById('landingPage');
  const auth = document.getElementById('authScreen');
  const app = document.getElementById('appShell');
  if (landing) landing.style.display = '';
  if (auth) auth.style.display = 'none';
  if (app) app.style.display = 'none';
}

function showAuthForm() {
  const landing = document.getElementById('landingPage');
  const auth = document.getElementById('authScreen');
  const app = document.getElementById('appShell');
  if (landing) landing.style.display = 'none';
  if (auth) auth.style.display = 'flex';
  if (app) app.style.display = 'none';
  // Landing page already shows how the app works — skip the welcome modal
  try { localStorage.setItem('team-tracker-welcome-seen-v2', '1'); } catch(_){}
}

function showAuthScreen() {
  // For unauthenticated users: show landing page (not auth form directly)
  showLandingPage();
}

function hideAuthScreen() {
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
      el.style.color = '#4caf50';
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
    await signOut(auth);
  } catch (err) {
    console.error('Sign out error:', err);
  }
}

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
      toggle.dataset.mode = isLogin ? 'signup' : 'login';
      toggle.textContent = isLogin ? 'Already have an account? Sign in' : "Don't have an account? Sign up";
      document.getElementById('authSubmitBtn').textContent = isLogin ? 'Sign Up' : 'Sign In';
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
      hideAuthScreen();
      if (typeof window.onAuthReady === 'function') window.onAuthReady(null);
    });
  }

  // Landing page → Auth screen transitions
  const landingCta1 = document.getElementById('landingGetStarted');
  const landingCta2 = document.getElementById('landingGetStarted2');
  if (landingCta1) landingCta1.addEventListener('click', showAuthForm);
  if (landingCta2) landingCta2.addEventListener('click', showAuthForm);

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
