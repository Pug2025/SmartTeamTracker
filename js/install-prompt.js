/* =====================================================================
   Add to Home Screen — install prompt UX (roadmap task 6.PWA)

   Backs the landing page's "Add to your home screen" claim with a real,
   touch-first, non-nagging flow. Two surfaces:

     1. A persistent "Add to Home Screen" entry in the header menu. Always
        discoverable, never a nag. Shown only when an install path exists
        and the app is not already installed.
     2. A dismissible banner shown once, after a game is saved (a natural,
        celebratory moment). Respects a localStorage dismissal flag so it
        does not reappear on every load.

   Platform branches:
     - Chrome / Android: capture `beforeinstallprompt`, preventDefault, and
       stash the event. On tap we call the stashed event's prompt() and
       discard it (it can only be used once). Hidden after `appinstalled`.
     - iOS Safari: iOS never fires `beforeinstallprompt`, so we detect
       iOS + Safari + not-standalone and show manual instructions with the
       Share glyph ("Tap Share, then Add to Home Screen").

   Never shows in standalone / installed mode (display-mode: standalone, or
   navigator.standalone === true on iOS). Uses only existing Ice tokens.
   ===================================================================== */
(function () {
  'use strict';

  // Never run the install UI inside the live spectator takeover view.
  if (window.__spectatorMode) return;

  var DISMISS_KEY = 'stt-install-dismissed';

  // ---- Environment detection --------------------------------------------
  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
    } catch (_) { return false; }
  }

  var ua = navigator.userAgent || '';
  // iPhone/iPod, plus iPadOS (which reports as "Macintosh" but is touch).
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Only Safari can Add to Home Screen on iOS. Chrome/Firefox/Edge/Opera on
  // iOS (CriOS/FxiOS/EdgiOS/OPiOS) cannot, so do not hand them the hint.
  var isIOSSafari = isIOS && !/crios|fxios|edgios|opios|mercury/i.test(ua);

  function isDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
  }

  // Stashed beforeinstallprompt event (Chrome / Android only).
  var deferredPrompt = null;
  // Show the auto banner at most once per page load, even before dismissal.
  var bannerShownThisSession = false;

  function el(id) { return document.getElementById(id); }

  // Is there any install path to offer right now?
  function canOfferInstall() {
    if (isStandalone()) return false;
    return !!deferredPrompt || isIOSSafari;
  }

  // ---- iOS Share glyph (inline SVG, currentColor) -----------------------
  var SHARE_GLYPH =
    '<svg class="install-share-glyph" viewBox="0 0 24 24" width="15" height="15" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M12 15V4"/><path d="M8 7l4-4 4 4"/>' +
    '<path d="M6 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 11H18"/>' +
    '</svg>';

  var CLOSE_GLYPH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  // ---- Menu entry -------------------------------------------------------
  function refreshMenuEntry() {
    var btn = el('btnInstallApp');
    if (!btn) return;
    btn.style.display = canOfferInstall() ? '' : 'none';
  }

  // ---- Banner -----------------------------------------------------------
  function hideBanner() {
    var b = el('installBanner');
    if (!b) return;
    b.hidden = true;
    b.classList.remove('show');
    b.innerHTML = '';
  }

  function renderBanner() {
    var b = el('installBanner');
    if (!b) return;

    var body;
    if (deferredPrompt) {
      // Chrome / Android: real one-tap install.
      body =
        '<div class="install-banner-text">Add Smart Team Tracker to your home screen for one tap access.</div>' +
        '<div class="install-banner-actions">' +
        '<button type="button" class="install-add-btn" id="installAddBtn">Add</button>' +
        '<button type="button" class="install-close-btn" id="installCloseBtn" aria-label="Dismiss">' + CLOSE_GLYPH + '</button>' +
        '</div>';
    } else {
      // iOS Safari: manual instructions with the Share glyph.
      body =
        '<div class="install-banner-text">Add to your home screen. Tap Share ' + SHARE_GLYPH +
        ' at the bottom of Safari, then Add to Home Screen.</div>' +
        '<div class="install-banner-actions">' +
        '<button type="button" class="install-close-btn" id="installCloseBtn" aria-label="Dismiss">' + CLOSE_GLYPH + '</button>' +
        '</div>';
    }
    b.innerHTML = body;

    var addBtn = el('installAddBtn');
    if (addBtn) addBtn.addEventListener('click', triggerInstall);
    var closeBtn = el('installCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
  }

  function showBanner() {
    if (isStandalone()) return;
    var b = el('installBanner');
    if (!b) return;
    renderBanner();
    b.hidden = false;
    // next frame so the slide-up transition runs
    requestAnimationFrame(function () { b.classList.add('show'); });
  }

  // User dismissed the banner: remember it so we do not nag on reload.
  function dismiss() {
    setDismissed();
    hideBanner();
  }

  // ---- Trigger the actual install --------------------------------------
  function triggerInstall() {
    if (deferredPrompt) {
      hideBanner();
      var evt = deferredPrompt;
      deferredPrompt = null; // consumed; can only be used once
      try {
        evt.prompt();
        if (evt.userChoice && typeof evt.userChoice.then === 'function') {
          evt.userChoice.then(function (choice) {
            if (choice && choice.outcome === 'accepted') setDismissed();
            refreshMenuEntry();
          });
        }
      } catch (_) {}
      refreshMenuEntry();
    } else if (isIOSSafari) {
      // No native prompt on iOS: show the manual instructions.
      showBanner();
    }
  }

  // ---- Public hook: called by app.js after a game is saved -------------
  function onGameSaved() {
    if (bannerShownThisSession) return;
    if (isDismissed()) return;
    if (!canOfferInstall()) return;
    bannerShownThisSession = true;
    showBanner();
  }

  // ---- Wiring -----------------------------------------------------------
  // Capture the Android/Chrome install event as early as possible.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    refreshMenuEntry();
  });

  // Once installed, stop offering and never nag again.
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    setDismissed();
    hideBanner();
    refreshMenuEntry();
  });

  function init() {
    var menuBtn = el('btnInstallApp');
    if (menuBtn) {
      // The menu entry is the discoverable path: it works even after the
      // banner was dismissed, so ignore the dismissal flag here.
      menuBtn.addEventListener('click', triggerInstall);
    }
    refreshMenuEntry();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposed for app.js to call at the "game saved" moment.
  window.InstallPrompt = {
    onGameSaved: onGameSaved,
    openInstall: triggerInstall,
    canOffer: canOfferInstall
  };
})();
