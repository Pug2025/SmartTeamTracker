/* ===== Multi-Team Manager ===== */
/* Stores teams in localStorage. Each team: { id, name, level, roster } */
/* When the user is signed in, also syncs to Supabase via /api/teams so       */
/* teams persist across devices. localStorage stays as the synchronous read   */
/* path; cloud writes are fire-and-forget. Guest mode is unchanged.           */

const TEAMS_KEY = 'team-tracker-teams';
const ACTIVE_TEAM_KEY = 'team-tracker-active-team';
const CACHE_USER_KEY = 'team-tracker-cache-user';

function genTeamId() {
  return 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function loadTeams() {
  try {
    return JSON.parse(localStorage.getItem(TEAMS_KEY)) || [];
  } catch (_) { return []; }
}

function saveTeams(teams) {
  localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
}

function getActiveTeamId() {
  return localStorage.getItem(ACTIVE_TEAM_KEY) || null;
}

function setActiveTeamId(id) {
  if (id) {
    localStorage.setItem(ACTIVE_TEAM_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_TEAM_KEY);
  }
}

function getActiveTeam() {
  const id = getActiveTeamId();
  if (!id) return null;
  return loadTeams().find(t => t.id === id) || null;
}

function createTeam(name, level, roster) {
  const teams = loadTeams();
  const team = {
    id: genTeamId(),
    name: (name || '').trim(),
    level: level || 'U11',
    roster: Array.isArray(roster) ? roster : []
  };
  teams.push(team);
  saveTeams(teams);
  pushTeam(team);
  return team;
}

function updateTeam(id, updates) {
  const teams = loadTeams();
  const idx = teams.findIndex(t => t.id === id);
  if (idx === -1) return null;
  if (updates.name !== undefined) teams[idx].name = (updates.name || '').trim();
  if (updates.level !== undefined) teams[idx].level = updates.level;
  if (updates.roster !== undefined) teams[idx].roster = updates.roster;
  saveTeams(teams);
  pushTeam(teams[idx]);
  return teams[idx];
}

function deleteTeam(id) {
  let teams = loadTeams();
  teams = teams.filter(t => t.id !== id);
  saveTeams(teams);
  if (getActiveTeamId() === id) {
    setActiveTeamId(teams.length ? teams[0].id : null);
  }
  pushDelete(id);
}

/* Save roster back to active team whenever roster changes */
function syncRosterToActiveTeam(roster) {
  const id = getActiveTeamId();
  if (!id) return;
  updateTeam(id, { roster });
}

/* ===== Cloud sync layer ===== */
/* All cloud calls are best-effort. localStorage is the source for reads;     */
/* cloud writes happen in the background and surface only via console logs.   */

let _syncing = false;
let _syncDone = false;

function getCurrentUserId() {
  try {
    if (typeof window.getAuthUserId === 'function') return window.getAuthUserId();
  } catch (_) {}
  return null;
}

async function authHeader() {
  try {
    const token = typeof window.getAuthToken === 'function' ? await window.getAuthToken() : null;
    if (!token) return null;
    return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  } catch (_) {
    return null;
  }
}

/**
 * Fetch + auth + JSON parse. Returns parsed body on success, null on any
 * failure (network error, non-OK status, parse error). Never throws.
 */
async function cloudFetch(path, options = {}) {
  const headers = await authHeader();
  if (!headers) return null; // No auth → guest mode, don't call cloud
  try {
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.warn('[teams] cloud ' + (options.method || 'GET') + ' ' + path + ' failed:', res.status, data);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[teams] cloud ' + (options.method || 'GET') + ' ' + path + ' threw:', err);
    return null;
  }
}

/**
 * Push one team to the cloud. Fire-and-forget; doesn't block callers.
 * Silent failure — localStorage already has the change.
 */
function pushTeam(team) {
  if (!getCurrentUserId()) return; // guest
  if (!team || !team.id) return;
  cloudFetch('/api/teams', {
    method: 'PUT',
    body: {
      id: team.id,
      name: team.name,
      level: team.level,
      roster: team.roster
    }
  });
}

/**
 * Push a delete for one team id. Fire-and-forget.
 */
function pushDelete(id) {
  if (!getCurrentUserId()) return;
  if (!id) return;
  cloudFetch('/api/teams?id=' + encodeURIComponent(id), { method: 'DELETE' });
}

/**
 * Pull teams from cloud, merge with localStorage, and repaint UI.
 *
 * Merge rules:
 *  - Cloud is the source of truth for any team id that exists in both.
 *  - Local-only teams (in localStorage but not cloud) get pushed up. They
 *    remain locally available; the push runs in the background.
 *  - If the cached user id doesn't match the current user, the local cache
 *    is wiped first to prevent leaking another user's teams into this
 *    account.
 *  - If the cached user id is missing entirely (first run after this update),
 *    local teams are assumed to belong to the current user and get pushed up.
 */
async function syncFromCloud() {
  if (_syncing) return;
  const uid = getCurrentUserId();
  if (!uid) return; // Guest mode — never call cloud
  _syncing = true;
  try {
    const cachedUid = localStorage.getItem(CACHE_USER_KEY);
    if (cachedUid && cachedUid !== uid) {
      // Different user than last sync — wipe stale cache before merging
      saveTeams([]);
      setActiveTeamId(null);
    }

    const result = await cloudFetch('/api/teams');
    if (!result || !result.success) {
      // Cloud unreachable — keep localStorage, don't mark as synced
      console.warn('[teams] cloud sync failed; using local cache');
      return;
    }

    const cloudTeams = Array.isArray(result.teams) ? result.teams.map(normalizeTeam).filter(Boolean) : [];
    const localTeams = loadTeams();
    const cloudIds = new Set(cloudTeams.map(t => t.id));

    // Push local-only teams up (initial-migration case for Jamie)
    const localOnly = localTeams.filter(t => t && t.id && !cloudIds.has(t.id));
    for (const t of localOnly) {
      pushTeam(t);
    }

    // Merged state = cloud teams (authoritative) + local-only teams (queued)
    const merged = [...cloudTeams, ...localOnly.map(normalizeTeam).filter(Boolean)];
    saveTeams(merged);
    localStorage.setItem(CACHE_USER_KEY, uid);

    // Reconcile active team — if the previous active was deleted on another
    // device, pick the first available team (or clear if none).
    const activeId = getActiveTeamId();
    if (activeId && !merged.some(t => t.id === activeId)) {
      setActiveTeamId(merged.length ? merged[0].id : null);
    } else if (!activeId && merged.length) {
      setActiveTeamId(merged[0].id);
    }

    _syncDone = true;

    // Repaint hooks — wired by app.js
    if (typeof window.refreshTeamUI === 'function') {
      try { window.refreshTeamUI(); } catch (e) { console.error(e); }
    }
    if (typeof window.refreshTeamModalIfOpen === 'function') {
      try { window.refreshTeamModalIfOpen(); } catch (e) { console.error(e); }
    }
    if (typeof window.applyActiveTeam === 'function') {
      try { window.applyActiveTeam(); } catch (e) { console.error(e); }
    }
  } finally {
    _syncing = false;
  }
}

function hasSyncedFromCloud() {
  return _syncDone;
}

/* Coerce a raw cloud row to the local team shape. Returns null if unusable. */
function normalizeTeam(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    level: typeof row.level === 'string' && row.level ? row.level : 'U11',
    roster: Array.isArray(row.roster) ? row.roster : []
  };
}

/* ===== Expose via window globals (bridge to app.js) ===== */
window.TeamManager = {
  loadTeams,
  saveTeams,
  getActiveTeamId,
  setActiveTeamId,
  getActiveTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  syncRosterToActiveTeam,
  // Cloud sync — used by auth-ready hook in app.js
  syncFromCloud,
  hasSyncedFromCloud
};
