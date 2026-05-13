// api/teams.js
// CRUD endpoint for per-user team records. Mirrors api/games/index.js
// patterns: Firebase JWT verification + user_id-scoped Supabase queries
// (no RLS — security is enforced at the API layer).
//
// Routes:
//   GET    /api/teams              → { success, teams: [...] }
//   PUT    /api/teams              → upsert one team by id, body: { id, name, level, roster }
//   DELETE /api/teams?id=...       → delete one team (scoped to user)
//
// All routes require a valid Firebase ID token in the Authorization header.

import { authenticateRequest } from './_auth.js';
import { checkRateLimit, sendRateLimited } from './_rate-limit.js';

const TEAM_ID_RE = /^t_[a-z0-9]{1,40}$/i;
const MAX_NAME_LEN = 80;
const MAX_LEVEL_LEN = 20;
const MAX_ROSTER_LEN = 100;
const MAX_GOALIES_LEN = 20;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // All team operations require an authenticated user.
  const auth = await authenticateRequest(req, res);
  if (auth === null) return; // authenticateRequest already sent 401
  const uid = auth.uid;
  if (!uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  // -------- GET: list teams for this user --------
  if (req.method === 'GET') {
    const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `teams-get:${uid}`, limit: 60 });
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

    try {
      const url = `${supabaseUrl}/rest/v1/teams?select=id,name,level,roster,goalies,created_at,updated_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc`;
      const r = await fetch(url, { headers: sbHeaders });
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: 'Fetch failed', details: data });
      }
      // Normalize roster + goalies: always arrays
      const teams = (Array.isArray(data) ? data : []).map((row) => ({
        id: row.id,
        name: row.name,
        level: row.level || 'U11',
        roster: Array.isArray(row.roster) ? row.roster : [],
        goalies: Array.isArray(row.goalies) ? row.goalies : [],
        updated_at: row.updated_at
      }));
      return res.status(200).json({ success: true, teams });
    } catch (err) {
      console.error('teams GET error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }

  // -------- PUT: upsert one team --------
  if (req.method === 'PUT') {
    const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `teams-put:${uid}`, limit: 30 });
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

    try {
      const body = req.body || (await readJsonBody(req));
      const validation = validateTeam(body);
      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }
      const team = validation.team;

      // Defense in depth: if a row with this id already exists under a
      // different user_id, refuse. (Shouldn't happen — team ids are random.)
      const existsUrl = `${supabaseUrl}/rest/v1/teams?select=id,user_id&id=eq.${encodeURIComponent(team.id)}&limit=1`;
      const existsRes = await fetch(existsUrl, { headers: sbHeaders });
      if (existsRes.ok) {
        const rows = await existsRes.json();
        if (rows.length && rows[0].user_id && rows[0].user_id !== uid) {
          return res.status(409).json({ error: 'Team id already exists for another user' });
        }
      }

      const payload = {
        id: team.id,
        user_id: uid,
        name: team.name,
        level: team.level,
        roster: team.roster,
        goalies: team.goalies,
        updated_at: new Date().toISOString()
      };

      // Upsert by primary key (id).
      const upsertRes = await fetch(`${supabaseUrl}/rest/v1/teams?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...sbHeaders,
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(payload)
      });

      const data = await upsertRes.json().catch(() => null);
      if (!upsertRes.ok) {
        return res.status(upsertRes.status).json({ error: 'Upsert failed', details: data });
      }

      const saved = Array.isArray(data) ? data[0] : data;
      return res.status(200).json({ success: true, team: saved });
    } catch (err) {
      console.error('teams PUT error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }

  // -------- DELETE: remove one team --------
  if (req.method === 'DELETE') {
    const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `teams-del:${uid}`, limit: 10 });
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

    const id = req.query.id;
    if (!id || !TEAM_ID_RE.test(String(id))) {
      return res.status(400).json({ error: 'Missing or invalid team id' });
    }

    try {
      const url = `${supabaseUrl}/rest/v1/teams?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}`;
      const r = await fetch(url, {
        method: 'DELETE',
        headers: sbHeaders
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: 'Delete failed', details: data });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('teams DELETE error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  }

  res.setHeader('Allow', 'GET, PUT, DELETE, OPTIONS');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

// Validate / normalize an inbound team payload. Returns { team } or { error }.
function validateTeam(body) {
  if (!body || typeof body !== 'object') return { error: 'Missing body' };

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!TEAM_ID_RE.test(id)) return { error: 'Invalid team id' };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Name is required' };
  if (name.length > MAX_NAME_LEN) return { error: `Name too long (max ${MAX_NAME_LEN})` };

  let level = typeof body.level === 'string' ? body.level.trim() : 'U11';
  if (!level) level = 'U11';
  if (level.length > MAX_LEVEL_LEN) return { error: `Level too long (max ${MAX_LEVEL_LEN})` };

  let roster = body.roster;
  if (roster == null) roster = [];
  if (!Array.isArray(roster)) return { error: 'Roster must be an array' };
  if (roster.length > MAX_ROSTER_LEN) return { error: `Too many roster entries (max ${MAX_ROSTER_LEN})` };

  // Roster entries are free-text strings (jersey numbers or names) per
  // existing app convention. Drop falsy/non-string entries.
  roster = roster.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim());

  let goalies = body.goalies;
  if (goalies == null) goalies = [];
  if (!Array.isArray(goalies)) return { error: 'Goalies must be an array' };
  if (goalies.length > MAX_GOALIES_LEN) return { error: `Too many goalies (max ${MAX_GOALIES_LEN})` };
  goalies = goalies.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim());

  return { team: { id, name, level, roster, goalies } };
}

// Fallback body reader when Vercel doesn't pre-parse JSON.
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; if (buf.length > 1_000_000) reject(new Error('Body too large')); });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : null); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
