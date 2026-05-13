// api/end-season.js
// Archives the current season's games for a team by stamping a label on
// every row where season is null. Matches the patterns in api/teams.js
// and api/games/index.js: Firebase JWT auth + user_id-scoped queries
// (no RLS — enforced at the API layer).
//
// Route:
//   POST /api/end-season
//   Body: { teamId: "t_...", seasonName: "2025–26" }
//   Returns: { success: true, archived: N, seasonName }
//
// Requires a valid Firebase ID token in the Authorization header.

import { authenticateRequest } from './_auth.js';
import { checkRateLimit, sendRateLimited } from './_rate-limit.js';

const TEAM_ID_RE = /^t_[a-z0-9]{1,40}$/i;
const MAX_SEASON_NAME_LEN = 60;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const auth = await authenticateRequest(req, res);
  if (auth === null) return;
  const uid = auth.uid;
  if (!uid) return res.status(401).json({ error: 'Authentication required' });

  const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `end-season:${uid}`, limit: 3 });
  if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

  const body = req.body || {};
  const teamId = String(body.teamId || '').trim();
  const seasonName = String(body.seasonName || '').trim();

  if (!TEAM_ID_RE.test(teamId)) {
    return res.status(400).json({ error: 'Invalid team id' });
  }
  if (!seasonName) {
    return res.status(400).json({ error: 'Season name is required' });
  }
  if (seasonName.length > MAX_SEASON_NAME_LEN) {
    return res.status(400).json({ error: `Season name must be ${MAX_SEASON_NAME_LEN} characters or less` });
  }

  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // Reject if a season with this label already exists on this team — keeps
    // the per-team season name space unique so the season selector list and
    // future SQL housekeeping stay unambiguous.
    const collisionUrl = `${supabaseUrl}/rest/v1/games?select=id&team_id=eq.${encodeURIComponent(teamId)}&user_id=eq.${encodeURIComponent(uid)}&season=eq.${encodeURIComponent(seasonName)}&limit=1`;
    const collisionRes = await fetch(collisionUrl, { headers: sbHeaders });
    const collisionRows = await collisionRes.json().catch(() => ([]));
    if (!collisionRes.ok) {
      return res.status(collisionRes.status).json({ error: 'Collision check failed', details: collisionRows });
    }
    if (Array.isArray(collisionRows) && collisionRows.length > 0) {
      return res.status(409).json({ error: `A season named "${seasonName}" already exists for this team.` });
    }

    // PATCH games SET season = seasonName WHERE team_id, user_id, season IS NULL.
    // Prefer: return=representation so PostgREST gives us the updated rows
    // back, which lets us count what we just archived.
    const patchUrl = `${supabaseUrl}/rest/v1/games?team_id=eq.${encodeURIComponent(teamId)}&user_id=eq.${encodeURIComponent(uid)}&season=is.null`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ season: seasonName })
    });
    const patchRows = await patchRes.json().catch(() => ([]));
    if (!patchRes.ok) {
      return res.status(patchRes.status).json({ error: 'Archive failed', details: patchRows });
    }
    const archived = Array.isArray(patchRows) ? patchRows.length : 0;
    return res.status(200).json({ success: true, archived, seasonName });
  } catch (error) {
    console.error('end-season error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
