/* ===== Spectator Mode ===== */
/* Detects ?live=CODE in URL, fetches live game state, subscribes to updates */

(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const liveCode = params.get('live');
  if (!liveCode) return; // Not spectator mode – bail out

  // Signal to other scripts that we're in spectator mode
  window.__spectatorMode = true;

  // Hide the auth screen and app shell, show spectator view
  document.addEventListener('DOMContentLoaded', () => {
    const authScreen = document.getElementById('authScreen');
    const appShell = document.getElementById('appShell');
    const specView = document.getElementById('spectatorView');

    if (authScreen) authScreen.style.display = 'none';
    if (appShell) appShell.style.display = 'none';
    if (specView) specView.style.display = 'flex';

    initSpectator(liveCode);
  });

  const $ = id => document.getElementById(id);

  let pollInterval = null;
  let lastEventCount = 0;

  async function initSpectator(code) {
    $('specStatus').textContent = 'Connecting...';

    // Fetch initial state
    const ok = await fetchLiveState(code);
    if (!ok) return;

    $('specStatus').textContent = 'Live — updates every few seconds';

    // Poll for updates (simple, reliable, works everywhere)
    pollInterval = setInterval(() => fetchLiveState(code), 5000);

    // Stop polling if page is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        clearInterval(pollInterval);
      } else {
        fetchLiveState(code);
        pollInterval = setInterval(() => fetchLiveState(code), 5000);
      }
    });
  }

  async function fetchLiveState(code) {
    try {
      const res = await fetch(`/api/live-game?code=${encodeURIComponent(code)}`);
      if (res.status === 404) {
        renderEnded();
        clearInterval(pollInterval);
        return false;
      }
      const d = await res.json();
      if (d.success && d.game && d.game.state) {
        renderState(d.game.state);
        if (d.game.state.final) {
          renderFinal();
          clearInterval(pollInterval);
        }
        return true;
      } else {
        renderEnded();
        clearInterval(pollInterval);
        return false;
      }
    } catch (e) {
      $('specStatus').textContent = 'Connection lost — retrying...';
      return false;
    }
  }

  function renderState(s) {
    // Title
    $('specTitle').textContent = (s.opponent || 'Opponent') + (s.level ? ' \u2022 ' + s.level : '');
    $('specThemLabel').textContent = s.opponent ? s.opponent.substring(0, 12).toUpperCase() : 'THEM';

    // Score
    $('specGA').textContent = s.goalsAgainst || 0;
    $('specGF').textContent = s.goalsFor || 0;
    $('specSA').textContent = (s.shotsAgainst || 0) + ' shots';
    $('specSF').textContent = (s.shotsFor || 0) + ' shots';

    // Period
    const p = s.period || 1;
    $('specPeriod').textContent = p <= 3 ? 'P' + p : (p === 4 ? 'OT' : 'P' + p);

    // Events feed
    const events = s.events || [];
    if (events.length === 0) {
      $('specEvents').innerHTML = '<div class="spec-event-placeholder">No key events yet</div>';
    } else {
      const html = events.slice().reverse().map(ev => {
        const icon = eventIcon(ev.type);
        const label = eventLabel(ev);
        const period = ev.period ? 'P' + ev.period : '';
        return `<div class="spec-event-row">
          <span class="spec-event-icon">${icon}</span>
          <span class="spec-event-text">${label}</span>
          <span class="spec-event-period">${period}</span>
        </div>`;
      }).join('');
      $('specEvents').innerHTML = html;

      // Flash if new events
      if (events.length > lastEventCount) {
        const first = $('specEvents').querySelector('.spec-event-row');
        if (first) {
          first.classList.add('spec-event-new');
          setTimeout(() => first.classList.remove('spec-event-new'), 2000);
        }
      }
      lastEventCount = events.length;
    }
  }

  function eventIcon(type) {
    switch (type) {
      case 'goal': case 'soft_goal': return '\uD83D\uDFE5'; // red square (goal against)
      case 'for_goal': return '\uD83D\uDFE9'; // green square (goal for)
      case 'penalty_for': return '\u26A0\uFE0F'; // warning (their penalty)
      case 'penalty_against': return '\u274C'; // X (our penalty)
      default: return '\u2022';
    }
  }

  function eventLabel(ev) {
    const player = ev.player ? ' #' + ev.player : '';
    const assist = ev.assist ? ' (A: #' + ev.assist + ')' : '';
    switch (ev.type) {
      case 'for_goal': return 'GOAL FOR' + player + assist;
      case 'goal': return 'Goal Against' + player;
      case 'soft_goal': return 'Soft Goal Against' + player;
      case 'penalty_for': return 'Power Play' + player;
      case 'penalty_against': return 'Penalty' + player;
      default: return ev.type + player;
    }
  }

  function renderFinal() {
    $('specStatus').textContent = 'Final score';
    $('spectatorView').classList.add('spec-ended');
    const badge = $('spectatorView').querySelector('.spectator-badge');
    if (badge) {
      badge.textContent = 'FINAL';
      badge.classList.add('spec-badge-final');
    }
  }

  function renderEnded() {
    $('specStatus').textContent = 'Game has ended';
    $('spectatorView').classList.add('spec-ended');
    const badge = $('spectatorView').querySelector('.spectator-badge');
    if (badge) {
      badge.textContent = 'FINAL';
      badge.classList.add('spec-badge-final');
    }
  }

})();
