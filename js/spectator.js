/* ===== Spectator Mode ===== */
/* Detects ?live=CODE in URL, fetches live game state, subscribes to updates */

(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const liveCode = params.get('live');
  if (!liveCode) return;

  // Signal to other scripts that we're in spectator mode.
  window.__spectatorMode = true;

  const $ = id => document.getElementById(id);

  const POLL_MS = 3000;
  let pollInterval = null;

  let hasSeenLiveData = false;
  let spectatorEnded = false;
  let consecutiveNotFound = 0;

  let lastEventFingerprint = '';
  let lastState = null;
  let lastUpdateMs = 0;
  let lastGameId = null;

  document.addEventListener('DOMContentLoaded', () => {
    const authScreen = $('authScreen');
    const appShell = $('appShell');
    const specView = $('spectatorView');

    if (authScreen) authScreen.style.display = 'none';
    if (appShell) appShell.style.display = 'none';
    if (specView) specView.style.display = 'flex';

    initSpectator(liveCode);
  });

  function startPolling(code) {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => fetchLiveState(code), POLL_MS);
  }

  async function initSpectator(code) {
    if ($('specStatus')) $('specStatus').textContent = 'Connecting...';

    await fetchLiveState(code);
    if (!hasSeenLiveData && !spectatorEnded && $('specStatus')) {
      $('specStatus').textContent = 'Waiting for coach to start live sharing...';
    }

    startPolling(code);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        clearInterval(pollInterval);
      } else {
        if (spectatorEnded) return;
        fetchLiveState(code);
        startPolling(code);
      }
    });
  }

  async function fetchLiveState(code) {
    try {
      const res = await fetch(`/api/live-game?code=${encodeURIComponent(code)}`, { cache: 'no-store' });

      if (res.status === 404) {
        consecutiveNotFound += 1;
        if (!hasSeenLiveData) {
          if ($('specStatus')) $('specStatus').textContent = 'Waiting for coach to start live sharing...';
          return false;
        }

        // Avoid ending on a single transient miss.
        if (consecutiveNotFound >= 3) {
          spectatorEnded = true;
          renderEnded();
          clearInterval(pollInterval);
        } else if ($('specStatus')) {
          $('specStatus').textContent = 'Signal interrupted - retrying...';
        }
        return false;
      }

      const d = await res.json();
      if (!(d && d.success && d.game && d.game.state)) {
        if ($('specStatus')) $('specStatus').textContent = 'Live feed unavailable - retrying...';
        return false;
      }

      consecutiveNotFound = 0;

      const incoming = normalizeState(d.game.state);
      if (!incoming) {
        if ($('specStatus')) $('specStatus').textContent = 'Waiting for game data...';
        return false;
      }

      const incomingGameId = d.game.game_id || null;
      const incomingUpdatedAt = d.game.updated_at || incoming.updatedAt || null;
      const incomingMs = incomingUpdatedAt ? Date.parse(incomingUpdatedAt) : NaN;

      // If game id changed, treat as a fresh feed snapshot.
      if (lastGameId && incomingGameId && lastGameId !== incomingGameId) {
        lastState = null;
        lastEventFingerprint = '';
        lastUpdateMs = 0;
      }
      if (incomingGameId) lastGameId = incomingGameId;

      if (!shouldAcceptIncomingState(incoming, incomingMs)) {
        if ($('specStatus')) $('specStatus').textContent = 'Live - holding latest verified update';
        return true;
      }

      hasSeenLiveData = true;
      renderState(incoming);
      lastState = incoming;
      if (Number.isFinite(incomingMs)) lastUpdateMs = incomingMs;

      if (incoming.final) {
        spectatorEnded = true;
        renderFinal();
        clearInterval(pollInterval);
      } else if ($('specStatus')) {
        $('specStatus').textContent = 'Live - updating every few seconds';
      }

      return true;
    } catch (_) {
      if (!spectatorEnded && $('specStatus')) {
        $('specStatus').textContent = 'Connection lost - retrying...';
      }
      return false;
    }
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const goalsFor = toNum(raw.goalsFor);
    const goalsAgainst = toNum(raw.goalsAgainst);
    const shotsFor = toNum(raw.shotsFor);
    const shotsAgainst = toNum(raw.shotsAgainst);

    // Minimal validity check.
    if (![goalsFor, goalsAgainst, shotsFor, shotsAgainst].every(Number.isFinite)) return null;

    const out = {
      schema: toNum(raw.schema) || 1,
      updatedAt: str(raw.updatedAt),
      opponent: str(raw.opponent) || 'Opponent',
      level: str(raw.level),
      date: str(raw.date),
      period: normalizePeriod(raw.period),
      goalsFor,
      goalsAgainst,
      shotsFor,
      shotsAgainst,
      saves: toNum(raw.saves),
      svPct: toNum(raw.svPct),
      shotSharePct: toNum(raw.shotSharePct),
      goalieScore: toNum(raw.goalieScore),
      teamScore: toNum(raw.teamScore),
      penaltiesFor: toNum(raw.penaltiesFor) || 0,
      penaltiesAgainst: toNum(raw.penaltiesAgainst) || 0,
      dangerFor: toNum(raw.dangerFor) || 0,
      dangerAgainst: toNum(raw.dangerAgainst) || 0,
      missedFor: toNum(raw.missedFor) || 0,
      missedAgainst: toNum(raw.missedAgainst) || 0,
      quality: normalizeQuality(raw.quality),
      momentum: normalizeMomentum(raw.momentum),
      events: normalizeEvents(raw.events),
      final: !!raw.final
    };

    if (!Number.isFinite(out.saves)) {
      out.saves = Math.max(0, out.shotsAgainst - out.goalsAgainst);
    }
    if (!Number.isFinite(out.svPct)) {
      out.svPct = out.shotsAgainst ? Math.round((out.saves / out.shotsAgainst) * 1000) / 10 : null;
    }

    return out;
  }

  function normalizeQuality(raw) {
    const quality = raw && typeof raw === 'object' ? raw : {};
    const pctFor = clamp(toNum(quality.pctFor), 0, 100, 50);
    return {
      pctFor,
      pctAgainst: 100 - pctFor,
      edge: str(quality.edge) || (pctFor >= 58 ? 'us' : pctFor <= 42 ? 'them' : 'even'),
      text: str(quality.text),
      xGDiff: toNum(quality.xGDiff),
      xGF: toNum(quality.xGF),
      xGA: toNum(quality.xGA),
      hdFor: toNum(quality.hdFor),
      hdAgainst: toNum(quality.hdAgainst)
    };
  }

  function normalizeMomentum(raw) {
    const momentum = raw && typeof raw === 'object' ? raw : {};
    const usPct = clamp(toNum(momentum.usPct), 0, 100, 50);
    const windowEvents = clamp(toNum(momentum.windowEvents), 4, 20, 8);
    const eventCount = clamp(toNum(momentum.eventCount), 0, 20, 0);
    return {
      usPct,
      themPct: 100 - usPct,
      windowEvents,
      eventCount,
      text: str(momentum.text),
      edge: str(momentum.edge) || (usPct >= 58 ? 'us' : usPct <= 42 ? 'them' : 'even')
    };
  }

  function normalizeEvents(rawEvents) {
    if (!Array.isArray(rawEvents)) return [];
    return rawEvents
      .filter(ev => ev && typeof ev === 'object' && str(ev.type))
      .map(ev => ({
        id: ev.id,
        type: str(ev.type),
        side: str(ev.side),
        period: normalizePeriod(ev.period),
        tISO: str(ev.tISO),
        timeLabel: str(ev.timeLabel),
        player: str(ev.player),
        assist: str(ev.assist),
        strength: str(ev.strength),
        highDanger: !!ev.highDanger
      }));
  }

  function shouldAcceptIncomingState(next, incomingMs) {
    if (!lastState) return true;

    const hasRegression =
      next.goalsFor < lastState.goalsFor ||
      next.goalsAgainst < lastState.goalsAgainst ||
      next.shotsFor < lastState.shotsFor ||
      next.shotsAgainst < lastState.shotsAgainst;

    if (hasRegression) {
      // Allow regressions only when snapshot timestamp is newer (e.g., undo/reset action).
      if (Number.isFinite(incomingMs) && (!lastUpdateMs || incomingMs > lastUpdateMs)) {
        return true;
      }
      return false;
    }

    if (Number.isFinite(incomingMs) && lastUpdateMs && incomingMs < lastUpdateMs) {
      return false;
    }

    return true;
  }

  function renderState(s) {
    const title = (s.opponent || 'Opponent') + (s.level ? ' • ' + s.level : '');
    if ($('specTitle')) $('specTitle').textContent = title;
    if ($('specSubtitle')) {
      $('specSubtitle').textContent = formatGameDate(s.date) || 'Live now';
    }

    if ($('specThemLabel')) $('specThemLabel').textContent = (s.opponent || 'THEM').toUpperCase();

    const prevGF = lastState ? lastState.goalsFor : s.goalsFor;
    const prevGA = lastState ? lastState.goalsAgainst : s.goalsAgainst;

    if ($('specGF')) $('specGF').textContent = s.goalsFor;
    if ($('specGA')) $('specGA').textContent = s.goalsAgainst;
    if ($('specSF')) $('specSF').textContent = `${s.shotsFor} shots`;
    if ($('specSA')) $('specSA').textContent = `${s.shotsAgainst} shots`;

    if (s.goalsFor !== prevGF) pulseScore('specGF');
    if (s.goalsAgainst !== prevGA) pulseScore('specGA');

    if ($('specPeriod')) $('specPeriod').textContent = periodLabel(s.period);

    renderSplitValue('specShotLine', s.shotsFor, s.shotsAgainst);
    if ($('specSaves')) $('specSaves').textContent = Number.isFinite(s.saves) ? `${Math.round(s.saves)}` : '0';
    renderSplitValue('specPenaltyLine', s.penaltiesFor, s.penaltiesAgainst);

    const df = Number.isFinite(s.dangerFor)
      ? s.dangerFor
      : (s.quality && Number.isFinite(s.quality.hdFor) ? s.quality.hdFor : 0);
    const da = Number.isFinite(s.dangerAgainst)
      ? s.dangerAgainst
      : (s.quality && Number.isFinite(s.quality.hdAgainst) ? s.quality.hdAgainst : 0);
    renderSplitValue('specDangerLine', df, da);

    renderQuality(s.quality);
    renderMomentum(s.momentum);
    renderEvents(s.events || []);

    if ($('specMetaLine')) {
      const updated = s.updatedAt ? new Date(s.updatedAt) : new Date();
      $('specMetaLine').textContent = Number.isNaN(updated.getTime())
        ? 'Live updates'
        : `Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
  }

  function renderQuality(q) {
    const pctFor = q && Number.isFinite(q.pctFor) ? q.pctFor : 50;
    if ($('specQualityLabel')) $('specQualityLabel').textContent = 'Chance Quality';
    if ($('specQualityText')) {
      if (pctFor >= 61) {
        $('specQualityText').textContent = 'We are getting the better looks';
        $('specQualityText').style.color = '#6fda8e';
      } else if (pctFor >= 54) {
        $('specQualityText').textContent = 'Small edge for us';
        $('specQualityText').style.color = '#6fda8e';
      } else if (pctFor <= 39) {
        $('specQualityText').textContent = 'They are getting the better looks';
        $('specQualityText').style.color = '#ff7b75';
      } else if (pctFor <= 46) {
        $('specQualityText').textContent = 'Small edge for them';
        $('specQualityText').style.color = '#ff7b75';
      } else {
        $('specQualityText').textContent = 'The chances have been pretty even';
        $('specQualityText').style.color = '#9fb0cf';
      }
    }

    const fill = $('specQualityFill');
    if (!fill) return;

    if (pctFor >= 50) {
      fill.style.left = '50%';
      fill.style.width = `${pctFor - 50}%`;
      fill.style.background = 'rgba(50, 215, 75, 0.9)';
    } else {
      fill.style.left = `${pctFor}%`;
      fill.style.width = `${50 - pctFor}%`;
      fill.style.background = 'rgba(255, 91, 85, 0.9)';
    }
  }

  function renderMomentum(m) {
    const usPct = m && Number.isFinite(m.usPct) ? m.usPct : 50;
    const eventCount = m && Number.isFinite(m.eventCount) ? m.eventCount : 0;
    const tilt = Math.round(usPct - 50);

    if ($('specMomentumLabel')) $('specMomentumLabel').textContent = 'Momentum';
    if ($('specMomentumNeedle')) {
      const needle = $('specMomentumNeedle');
      needle.style.left = `${usPct}%`;
      if (tilt >= 8) {
        needle.style.background = '#32d74b';
        needle.style.boxShadow = '0 0 0 1px rgba(4,8,15,0.7), 0 0 10px rgba(50,215,75,0.45)';
      } else if (tilt <= -8) {
        needle.style.background = '#ff5b55';
        needle.style.boxShadow = '0 0 0 1px rgba(4,8,15,0.7), 0 0 10px rgba(255,91,85,0.45)';
      } else {
        needle.style.background = '#b8c6e0';
        needle.style.boxShadow = '0 0 0 1px rgba(4,8,15,0.7), 0 0 10px rgba(184,198,224,0.45)';
      }
    }

    if ($('specMomentumText')) {
      if (eventCount <= 1) {
        $('specMomentumText').textContent = 'Still settling in';
        $('specMomentumText').style.color = '#9fb0cf';
      } else if (usPct >= 64) {
        $('specMomentumText').textContent = 'We have had the push lately';
        $('specMomentumText').style.color = '#6fda8e';
      } else if (usPct >= 56) {
        $('specMomentumText').textContent = 'Momentum is leaning our way';
        $('specMomentumText').style.color = '#6fda8e';
      } else if (usPct <= 36) {
        $('specMomentumText').textContent = 'They have had the push lately';
        $('specMomentumText').style.color = '#ff7b75';
      } else if (usPct <= 44) {
        $('specMomentumText').textContent = 'Momentum is leaning their way';
        $('specMomentumText').style.color = '#ff7b75';
      } else {
        $('specMomentumText').textContent = 'It has been back and forth lately';
        $('specMomentumText').style.color = '#9fb0cf';
      }
    }
  }

  function renderEvents(events) {
    if (!events.length) {
      if ($('specEvents')) $('specEvents').innerHTML = '<div class="spec-event-placeholder">The game feed will appear here</div>';
      lastEventFingerprint = '';
      return;
    }

    const rows = events.slice().reverse();
    const html = rows.map(ev => {
      const icon = eventVisual(ev.type);
      const label = eventLabel(ev);
      const period = periodLabel(ev.period);
      const at = ev.timeLabel || formatTimeLabel(ev.tISO);
      const tone = eventToneClass(ev.type, ev.side);
      return `<div class="spec-event-row ${tone}">
        <span class="spec-event-icon ${icon.kind}">${escapeHtml(icon.label)}</span>
        <span class="spec-event-text">${escapeHtml(label)}</span>
        <span class="spec-event-period">${escapeHtml(period)}</span>
        <span class="spec-event-time">${escapeHtml(at)}</span>
      </div>`;
    }).join('');

    if ($('specEvents')) $('specEvents').innerHTML = html;

    const newest = rows[0];
    const fp = newest ? `${newest.id || ''}|${newest.tISO || ''}|${newest.type}` : '';
    if (fp && lastEventFingerprint && fp !== lastEventFingerprint) {
      const first = $('specEvents') ? $('specEvents').querySelector('.spec-event-row') : null;
      if (first) {
        first.classList.add('spec-event-new');
        setTimeout(() => first.classList.remove('spec-event-new'), 2000);
      }
    }
    lastEventFingerprint = fp;
  }

  function eventVisual(type) {
    switch (type) {
      case 'for_goal': return { label: '▲', kind: 'glyph' };
      case 'goal':
      case 'soft_goal': return { label: '▼', kind: 'glyph' };
      case 'penalty_for':
      case 'penalty_against': return { label: '!', kind: 'glyph' };
      default: return { label: '', kind: 'dot' };
    }
  }

  function eventLabel(ev) {
    const player = ev.player ? ` #${ev.player}` : '';
    const assist = ev.assist ? ` • A #${ev.assist}` : '';

    switch (ev.type) {
      case 'for_goal': return `We score${player}${assist}`;
      case 'goal': return `They score${player}`;
      case 'soft_goal': return `One slips through${player}`;
      case 'penalty_for': return 'Penalty on them';
      case 'penalty_against': return 'Penalty on us';
      case 'breakaway_for': return 'Our breakaway';
      case 'breakaway_against': return 'Their breakaway';
      case 'odd_man_rush_for': return 'Our rush chance';
      case 'odd_man_rush_against': return 'Their rush chance';
      case 'missed_chance_for': return 'Our big chance';
      case 'missed_chance_against': return 'Their big chance';
      case 'big_save': return 'Big save';
      case 'bad_rebound': return 'Loose rebound';
      default: return ev.type || 'Event';
    }
  }

  function eventToneClass(type, side) {
    if (type === 'for_goal') return 'ev-goal-for';
    if (type === 'goal' || type === 'soft_goal') return 'ev-goal-against';
    if (side === 'us') return 'ev-good';
    if (side === 'them') return 'ev-danger';
    return '';
  }

  function renderFinal() {
    if ($('specStatus')) $('specStatus').textContent = 'Final score';
    const view = $('spectatorView');
    if (view) view.classList.add('spec-ended');
    const badge = view ? view.querySelector('.spectator-badge') : null;
    if (badge) {
      badge.textContent = 'FINAL';
      badge.classList.add('spec-badge-final');
    }
    if ($('specMetaLine')) {
      const prev = $('specMetaLine').textContent;
      $('specMetaLine').textContent = prev ? `${prev} • Game complete` : 'Game complete';
    }
  }

  function renderEnded() {
    if ($('specStatus')) $('specStatus').textContent = 'Live feed ended';
    const view = $('spectatorView');
    if (view) view.classList.add('spec-ended');
    const badge = view ? view.querySelector('.spectator-badge') : null;
    if (badge) {
      badge.textContent = 'FINAL';
      badge.classList.add('spec-badge-final');
    }
    if ($('specMetaLine')) $('specMetaLine').textContent = 'Live sharing has ended';
  }

  function periodLabel(p) {
    const n = normalizePeriod(p);
    if (n <= 3) return `P${n}`;
    if (n === 4) return 'OT';
    return `P${n}`;
  }

  function formatTimeLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatGameDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderSplitValue(id, us, them) {
    const el = $(id);
    if (!el) return;
    const safeUs = Number.isFinite(us) ? Math.round(us) : 0;
    const safeThem = Number.isFinite(them) ? Math.round(them) : 0;
    el.innerHTML =
      `<span class="spec-split"><span class="spec-split-them">${safeThem}</span>` +
      `<span class="spec-split-sep">-</span><span class="spec-split-us">${safeUs}</span></span>`;
  }

  function pulseScore(id) {
    const el = $(id);
    if (!el) return;
    el.style.transform = 'scale(1.12)';
    setTimeout(() => { el.style.transform = ''; }, 220);
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  function clamp(v, min, max, fallback) {
    if (!Number.isFinite(v)) return fallback;
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function normalizePeriod(p) {
    const n = Number(p);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(9, Math.round(n)));
  }

  function escapeHtml(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
