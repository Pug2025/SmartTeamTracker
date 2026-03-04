/* ===== Multi-Team Manager ===== */
/* Stores teams in localStorage. Each team: { id, name, level, roster } */

const TEAMS_KEY = 'team-tracker-teams';
const ACTIVE_TEAM_KEY = 'team-tracker-active-team';

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
  return teams[idx];
}

function deleteTeam(id) {
  let teams = loadTeams();
  teams = teams.filter(t => t.id !== id);
  saveTeams(teams);
  if (getActiveTeamId() === id) {
    setActiveTeamId(teams.length ? teams[0].id : null);
  }
}

/* Save roster back to active team whenever roster changes */
function syncRosterToActiveTeam(roster) {
  const id = getActiveTeamId();
  if (!id) return;
  updateTeam(id, { roster });
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
  syncRosterToActiveTeam
};
