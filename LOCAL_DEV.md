# SmartTeamTracker Local Dev

## 1) Start the app locally (non-8000)

```bash
cd /Users/jamie/SmartTeamTracker
python3 dev_server.py --host 127.0.0.1 --port 8787
```

Open: `http://localhost:8787`

For spectator testing on a second device (phone/tablet), start with:

```bash
python3 dev_server.py --host 0.0.0.0 --port 8787
```

Then open `http://<your-computer-lan-ip>:8787` on both devices.

## 2) API mode

- If `.env.local` has `SUPABASE_URL` + `SUPABASE_ANON_KEY`, API routes use your real Supabase DB.
- If those values are missing, API routes use `.dev-data.json` so you can still test end-to-end locally.

## 3) Configure Supabase for real DB testing

```bash
cd /Users/jamie/SmartTeamTracker
cp .env.local.example .env.local
# Edit .env.local and set:
# SUPABASE_URL=https://<project>.supabase.co
# SUPABASE_ANON_KEY=<your anon key>
```

Restart the server after updating `.env.local`.

## 4) Firebase auth checklist (for Google/email login)

- Firebase Auth providers enabled in your Firebase project.
- Authorized domains include `localhost`.
- You open the app at `http://localhost:8787` (not file:// and not a random host).

## 5) Quick API smoke tests

```bash
curl -sS http://127.0.0.1:8787/api/ping
curl -sS -X POST http://127.0.0.1:8787/api/save-game \
  -H "Content-Type: application/json" \
  -d '{"game":{"gameId":"local-test-1","Date":"2026-03-05","Opponent":"Test","Level":"U11","GF":2,"GA":1}}'
curl -sS "http://127.0.0.1:8787/api/games?limit=5"
```

## 6) Stop server

Press `Ctrl+C` in the terminal running `dev_server.py`.
