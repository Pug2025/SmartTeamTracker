#!/usr/bin/env python3
"""Local dev server for SmartTeamTracker.

Serves static files and emulates the Vercel /api routes:
- /api/ping
- /api/save-game
- /api/games
- /api/live-game
- /api/spectator-share
- /api/spectator-preview

Modes:
- Supabase mode: when SUPABASE_URL and SUPABASE_ANON_KEY are set.
- Local mode: fallback JSON store in .dev-data.json (good for offline dev/test).
"""

from __future__ import annotations

import argparse
import html
import json
import os
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_int(value: Any) -> int:
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return 0


def period_label(value: Any) -> str:
    try:
        period = int(round(float(value)))
    except (TypeError, ValueError):
        return "LIVE"
    if period <= 0:
        return "LIVE"
    if period <= 3:
        return f"P{period}"
    if period == 4:
        return "OT"
    return f"P{period}"


def title_case(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "Opponent"
    return " ".join(part[:1].upper() + part[1:].lower() for part in text.split())


def truncate_text(value: Any, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return f"{text[: max(0, max_chars - 3)].strip()}..."


def build_share_model(snapshot: dict[str, Any] | None, code: str) -> dict[str, Any]:
    state = snapshot.get("state") if isinstance(snapshot, dict) and isinstance(snapshot.get("state"), dict) else {}
    opponent_raw = state.get("opponent") if isinstance(state.get("opponent"), str) else ""
    opponent = title_case(opponent_raw)
    goals_for = safe_int(state.get("goalsFor"))
    goals_against = safe_int(state.get("goalsAgainst"))
    period = period_label(state.get("period"))
    updated_at = snapshot.get("updated_at") if isinstance(snapshot, dict) else None
    version = str(updated_at or utc_now_iso()).replace(":", "").replace("-", "")
    return {
        "code": code,
        "opponent": opponent,
        "opponent_upper": str(opponent_raw or "Opponent").upper(),
        "goals_for": goals_for,
        "goals_against": goals_against,
        "period": period,
        "version": version,
        "title": f"{truncate_text(opponent, 24)} • {goals_against}-{goals_for}",
        "description": f"Live spectator view • {period}",
    }


def render_share_html(model: dict[str, Any], base_url: str) -> str:
    code = quote(model.get("code") or "", safe="")
    image_url = f"{base_url}/api/spectator-preview?live={code}&v={quote(model.get('version') or '0', safe='')}"
    open_url = f"{base_url}/?live={code}" if code else f"{base_url}/"
    title = html.escape(str(model.get("title") or "Live Spectator View"))
    description = html.escape(str(model.get("description") or "Open the live spectator view."))
    opponent = html.escape(str(model.get("opponent") or "Opponent"))
    goals_against = html.escape(str(model.get("goals_against", 0)))
    goals_for = html.escape(str(model.get("goals_for", 0)))
    period = html.escape(str(model.get("period") or "LIVE"))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>{title}</title>
<meta name="theme-color" content="#07111b" />
<meta name="description" content="{description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="SmartTeamTracker" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{description}" />
<meta property="og:url" content="{html.escape(f'{base_url}/api/spectator-share?live={code}')}" />
<meta property="og:image" content="{html.escape(image_url)}" />
<meta property="og:image:secure_url" content="{html.escape(image_url)}" />
<meta property="og:image:type" content="image/svg+xml" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="{html.escape(f'{model.get("opponent") or "Opponent"} live spectator preview')}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{title}" />
<meta name="twitter:description" content="{description}" />
<meta name="twitter:image" content="{html.escape(image_url)}" />
<style>
  :root{{color-scheme:dark}}
  body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at 50% -10%, rgba(145,188,236,0.18), transparent 28%),linear-gradient(180deg,#08111b 0%,#04090f 100%);color:#f4f6fb;font-family:"Avenir Next","SF Pro Display",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
  .card{{width:min(100%,520px);background:rgba(12,19,30,0.96);border:1px solid #27415d;border-radius:24px;padding:28px 24px 24px;box-shadow:0 24px 60px rgba(0,0,0,0.36),inset 0 1px 0 rgba(255,255,255,0.03);text-align:center}}
  .eyebrow{{color:#8fe3ad;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase}}
  h1{{margin:14px 0 10px;font-size:32px;line-height:1.08;letter-spacing:-0.7px}}
  p{{margin:0;color:#aab8cc;font-size:15px;line-height:1.5}}
  .preview{{margin:22px auto 0;width:100%;border-radius:18px;border:1px solid rgba(135,155,187,0.16);overflow:hidden;background:#0a121d}}
  .preview img{{display:block;width:100%;height:auto}}
  .fallback{{margin-top:18px;font-size:14px}}
  .fallback a{{color:#d8e6f6}}
</style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Live Spectator</div>
    <h1>{opponent} &bull; {goals_against}-{goals_for}</h1>
    <p>{period} live spectator view</p>
    <div class="preview"><img src="{html.escape(image_url)}" alt="{html.escape(f'{model.get("opponent") or "Opponent"} spectator preview')}" /></div>
    <div class="fallback"><a href="{html.escape(open_url)}">Open spectator view</a></div>
  </main>
  <script>window.location.replace({json.dumps(open_url)});</script>
</body>
</html>"""


def render_preview_svg(model: dict[str, Any]) -> str:
    period = html.escape(str(model.get("period") or "LIVE"))
    goals_against = html.escape(str(model.get("goals_against", 0)))
    goals_for = html.escape(str(model.get("goals_for", 0)))
    title = html.escape(str(model.get("title") or "Live Spectator View"))
    description = html.escape(str(model.get("description") or "Open the live spectator view."))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="{title}">
  <defs>
    <linearGradient id="bg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#060b12" />
      <stop offset="100%" stop-color="#02050a" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="0%" r="70%">
      <stop offset="0%" stop-color="#17345a" stop-opacity="0.28" />
      <stop offset="100%" stop-color="#17345a" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#glow)" />
  <rect x="58" y="40" width="1084" height="548" rx="30" fill="#0a111b" stroke="#213450" stroke-width="2" />
  <circle cx="106" cy="106" r="10" fill="#79d79a" />
  <rect x="92" y="166" width="1016" height="300" rx="24" fill="#070c13" stroke="#223651" stroke-width="2" />
  <rect x="118" y="194" width="300" height="244" rx="18" fill="#1c1d21" />
  <rect x="448" y="224" width="304" height="92" rx="16" fill="#122030" />
  <rect x="782" y="194" width="300" height="244" rx="18" fill="#111925" />

  <rect x="132" y="194" width="272" height="4" rx="2" fill="#b19a8d" opacity="0.65" />
  <rect x="796" y="194" width="272" height="4" rx="2" fill="#a7bbcd" opacity="0.72" />

  <text x="268" y="236" text-anchor="middle" fill="#c1b2a9" font-size="28" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-weight="800" letter-spacing="2">OPP</text>
  <text x="932" y="236" text-anchor="middle" fill="#bfd0df" font-size="28" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-weight="800" letter-spacing="2">US</text>
  <text x="268" y="384" text-anchor="middle" fill="#f4f6fb" font-size="140" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-weight="800">{goals_against}</text>
  <text x="932" y="384" text-anchor="middle" fill="#f4f6fb" font-size="140" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-weight="800">{goals_for}</text>
  <text x="600" y="286" text-anchor="middle" fill="#d7dfed" font-size="48" font-family="Avenir Next, Helvetica, Arial, sans-serif" font-weight="800">{period}</text>
  <title>{title}</title>
  <desc>{description}</desc>
</svg>"""


class Backend:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.data_file = root / ".dev-data.json"
        self.lock = threading.Lock()
        self.supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        self.supabase_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()

    @property
    def mode(self) -> str:
        if self.supabase_url and self.supabase_key:
            return "supabase"
        return "local"

    def _decode_response(self, body: bytes) -> Any:
        if not body:
            return {}
        text = body.decode("utf-8", errors="replace")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"message": text}

    def _supabase_request(
        self,
        method: str,
        path_and_query: str,
        payload: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        if not (self.supabase_url and self.supabase_key):
            return 500, {"error": "Missing SUPABASE_URL or SUPABASE_ANON_KEY"}

        url = f"{self.supabase_url}/rest/v1/{path_and_query.lstrip('/')}"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)

        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")

        req = Request(url, data=data, headers=headers, method=method.upper())

        try:
            with urlopen(req, timeout=20) as response:
                body = response.read()
                return response.status, self._decode_response(body)
        except HTTPError as err:
            return err.code, self._decode_response(err.read())
        except URLError as err:
            return 502, {"error": "Network error", "details": str(err.reason)}

    def _read_local_data(self) -> dict[str, Any]:
        if not self.data_file.exists():
            return {"next_game_id": 1, "games": [], "live_games": []}

        try:
            data = json.loads(self.data_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}

        if not isinstance(data, dict):
            data = {}
        data.setdefault("next_game_id", 1)
        data.setdefault("games", [])
        data.setdefault("live_games", [])
        return data

    def _write_local_data(self, data: dict[str, Any]) -> None:
        self.data_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def ping(self) -> tuple[int, dict[str, Any]]:
        if self.mode == "local":
            return 200, {"message": "SmartTeamTracker API is working (local mode)"}

        status, _ = self._supabase_request("GET", "games?select=id&limit=1")
        if 200 <= status < 300:
            return 200, {"message": "SmartTeamTracker API is working"}
        return 502, {"message": "Database unreachable"}

    def save_game(self, game: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        row = {
            "game_id": game.get("gameId"),
            "date": game.get("Date"),
            "opponent": game.get("Opponent"),
            "level": game.get("Level"),
            "user_id": game.get("user_id"),
            "team_id": game.get("team_id"),
            "data": game,
        }

        if self.mode == "supabase":
            status, payload = self._supabase_request(
                "POST",
                "games",
                payload=row,
                extra_headers={"Prefer": "return=representation"},
            )
            if not (200 <= status < 300):
                return status, {"error": "Save failed", "details": payload}
            record = payload[0] if isinstance(payload, list) and payload else payload
            game_id = record.get("id") if isinstance(record, dict) else None
            return 200, {"success": True, "id": game_id}

        with self.lock:
            data = self._read_local_data()
            next_id = int(data.get("next_game_id", 1))
            data["next_game_id"] = next_id + 1
            local_row = {
                "id": next_id,
                "created_at": utc_now_iso(),
                **row,
            }
            data["games"].append(local_row)
            self._write_local_data(data)
        return 200, {"success": True, "id": next_id}

    def list_games(
        self, limit: int, user_id: str | None, team_id: str | None
    ) -> tuple[int, dict[str, Any]]:
        limit = max(1, min(limit, 100))

        if self.mode == "supabase":
            query = [
                "select=id,game_id,date,opponent,level,data",
                "order=created_at.desc",
                f"limit={limit}",
            ]
            if user_id:
                query.append(f"user_id=eq.{quote(user_id, safe='')}")
            if team_id:
                query.append(f"team_id=eq.{quote(team_id, safe='')}")
            status, payload = self._supabase_request("GET", f"games?{'&'.join(query)}")
            if not (200 <= status < 300):
                return status, {"error": "Fetch failed", "details": payload}
            return 200, {"success": True, "games": payload}

        with self.lock:
            data = self._read_local_data()
            games = list(data.get("games", []))

        if user_id:
            games = [g for g in games if str(g.get("user_id") or "") == user_id]
        if team_id:
            games = [g for g in games if str(g.get("team_id") or "") == team_id]

        games.sort(key=lambda g: g.get("created_at", ""), reverse=True)
        filtered = [
            {
                "id": g.get("id"),
                "game_id": g.get("game_id"),
                "date": g.get("date"),
                "opponent": g.get("opponent"),
                "level": g.get("level"),
                "data": g.get("data"),
            }
            for g in games[:limit]
        ]
        return 200, {"success": True, "games": filtered}

    def delete_game(self, game_id: str) -> tuple[int, dict[str, Any]]:
        if self.mode == "supabase":
            status, payload = self._supabase_request(
                "DELETE", f"games?id=eq.{quote(game_id, safe='')}"
            )
            if not (200 <= status < 300):
                return status, {"error": "Delete failed", "details": payload}
            return 200, {"success": True}

        with self.lock:
            data = self._read_local_data()
            games = data.get("games", [])
            before = len(games)
            data["games"] = [g for g in games if str(g.get("id")) != game_id]
            removed = len(data["games"]) != before
            self._write_local_data(data)

        if not removed:
            return 404, {"error": "Game not found"}
        return 200, {"success": True}

    def get_live_game(self, code: str) -> tuple[int, dict[str, Any]]:
        if self.mode == "supabase":
            status, payload = self._supabase_request(
                "GET",
                "live_games?"
                f"share_code=eq.{quote(code, safe='')}&"
                "select=share_code,game_id,state,updated_at&"
                "order=updated_at.desc&limit=1",
            )
            if not (200 <= status < 300):
                return status, {"error": "Fetch failed", "details": payload}
            if not isinstance(payload, list) or not payload:
                return 404, {"error": "Game not found or has ended"}
            return 200, {"success": True, "game": payload[0]}

        with self.lock:
            data = self._read_local_data()
            rows = data.get("live_games", [])
            matches = [row for row in rows if row.get("share_code") == code]
            matches.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
            match = matches[0] if matches else None

        if not match:
            return 404, {"error": "Game not found or has ended"}
        return (
            200,
            {
                "success": True,
                "game": {
                    "share_code": match.get("share_code"),
                    "game_id": match.get("game_id"),
                    "state": match.get("state"),
                    "updated_at": match.get("updated_at"),
                },
            },
        )

    def upsert_live_game(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        share_code = payload.get("share_code")
        state = payload.get("state")
        if not share_code or state is None:
            return 400, {"error": "Missing share_code or state"}

        row = {
            "share_code": share_code,
            "game_id": payload.get("game_id"),
            "user_id": payload.get("user_id"),
            "state": state,
            "updated_at": utc_now_iso(),
        }

        if self.mode == "supabase":
            status, resp = self._supabase_request(
                "POST",
                "live_games",
                payload=row,
                extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            )
            if not (200 <= status < 300):
                return status, {"error": "Upsert failed", "details": resp}
            return 200, {"success": True}

        with self.lock:
            data = self._read_local_data()
            rows = data.get("live_games", [])
            idx = next(
                (i for i, existing in enumerate(rows) if existing.get("share_code") == share_code),
                None,
            )
            if idx is None:
                rows.append(row)
            else:
                rows[idx] = row
            data["live_games"] = rows
            self._write_local_data(data)

        return 200, {"success": True}

    def delete_live_game(self, code: str) -> tuple[int, dict[str, Any]]:
        if self.mode == "supabase":
            status, payload = self._supabase_request(
                "DELETE", f"live_games?share_code=eq.{quote(code, safe='')}"
            )
            if not (200 <= status < 300):
                return status, {"error": "Delete failed", "details": payload}
            return 200, {"success": True}

        with self.lock:
            data = self._read_local_data()
            rows = data.get("live_games", [])
            before = len(rows)
            data["live_games"] = [r for r in rows if r.get("share_code") != code]
            removed = len(data["live_games"]) != before
            self._write_local_data(data)

        if not removed:
            return 404, {"error": "Game not found or has ended"}
        return 200, {"success": True}


class AppHandler(SimpleHTTPRequestHandler):
    backend: Backend

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _send_body(self, status: int, body: bytes, content_type: str, cache_control: str = "no-store") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _base_url(self) -> str:
        proto = self.headers.get("X-Forwarded-Proto", "http")
        host = self.headers.get("Host", f"{self.server.server_name}:{self.server.server_port}")
        return f"{proto}://{host}"

    def _read_json_body(self) -> dict[str, Any]:
        length_header = self.headers.get("Content-Length")
        if not length_header:
            return {}

        try:
            length = int(length_header)
        except ValueError:
            raise ValueError("Invalid Content-Length header") from None

        raw = self.rfile.read(max(length, 0))
        if not raw:
            return {}

        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body") from exc

        if not isinstance(parsed, dict):
            raise ValueError("JSON body must be an object")
        return parsed

    def _method_not_allowed(self) -> None:
        self._send_json(405, {"error": "Method Not Allowed"})

    def _handle_api(self, method: str) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)

        if route == "/api/ping":
            if method != "GET":
                self._method_not_allowed()
                return
            status, payload = self.backend.ping()
            payload["mode"] = self.backend.mode
            self._send_json(status, payload)
            return

        if route == "/api/save-game":
            if method != "POST":
                self._method_not_allowed()
                return
            try:
                payload = self._read_json_body()
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
                return
            game = payload.get("game")
            if not isinstance(game, dict):
                self._send_json(400, {"error": "Invalid payload. Expected { game: {...} }"})
                return
            status, body = self.backend.save_game(game)
            self._send_json(status, body)
            return

        if route == "/api/games":
            if method == "GET":
                limit_raw = (query.get("limit") or ["50"])[0]
                try:
                    limit = int(limit_raw)
                except ValueError:
                    limit = 50
                user_id = (query.get("user_id") or [None])[0]
                team_id = (query.get("team_id") or [None])[0]
                status, body = self.backend.list_games(limit=limit, user_id=user_id, team_id=team_id)
                self._send_json(status, body)
                return

            if method == "DELETE":
                game_id = (query.get("id") or [None])[0]
                if not game_id:
                    self._send_json(400, {"error": "Missing game id"})
                    return
                status, body = self.backend.delete_game(game_id)
                self._send_json(status, body)
                return

            self._method_not_allowed()
            return

        if route == "/api/live-game":
            if method == "GET":
                code = (query.get("code") or [None])[0]
                if not code:
                    self._send_json(400, {"error": "Missing share code"})
                    return
                status, body = self.backend.get_live_game(code)
                self._send_json(status, body)
                return

            if method == "PUT":
                try:
                    payload = self._read_json_body()
                except ValueError as err:
                    self._send_json(400, {"error": str(err)})
                    return
                status, body = self.backend.upsert_live_game(payload)
                self._send_json(status, body)
                return

            if method == "DELETE":
                code = (query.get("code") or [None])[0]
                if not code:
                    self._send_json(400, {"error": "Missing share code"})
                    return
                status, body = self.backend.delete_live_game(code)
                self._send_json(status, body)
                return

            self._method_not_allowed()
            return

        if route == "/api/spectator-share":
            if method != "GET":
                self._method_not_allowed()
                return
            code = (query.get("live") or query.get("code") or [""])[0]
            status, body = self.backend.get_live_game(code) if code else (200, {"game": None})
            snapshot = body.get("game") if status == 200 and isinstance(body, dict) else None
            model = build_share_model(snapshot, code)
            document = render_share_html(model, self._base_url()).encode("utf-8")
            self._send_body(200 if snapshot or not code else 404, document, "text/html; charset=utf-8")
            return

        if route == "/api/spectator-preview":
            if method != "GET":
                self._method_not_allowed()
                return
            code = (query.get("live") or query.get("code") or [""])[0]
            status, body = self.backend.get_live_game(code) if code else (200, {"game": None})
            snapshot = body.get("game") if status == 200 and isinstance(body, dict) else None
            model = build_share_model(snapshot, code)
            image = render_preview_svg(model).encode("utf-8")
            self._send_body(
                200 if snapshot or not code else 404,
                image,
                "image/svg+xml; charset=utf-8",
                cache_control="no-store, max-age=0",
            )
            return

        self._send_json(404, {"error": "Not Found"})

    def do_OPTIONS(self) -> None:  # noqa: N802
        if urlparse(self.path).path.startswith("/api/"):
            self._send_json(200, {"ok": True})
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path.startswith("/api/"):
            self._handle_api("GET")
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path.startswith("/api/"):
            self._handle_api("POST")
            return
        self._method_not_allowed()

    def do_PUT(self) -> None:  # noqa: N802
        if urlparse(self.path).path.startswith("/api/"):
            self._handle_api("PUT")
            return
        self._method_not_allowed()

    def do_DELETE(self) -> None:  # noqa: N802
        if urlparse(self.path).path.startswith("/api/"):
            self._handle_api("DELETE")
            return
        self._method_not_allowed()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SmartTeamTracker local dev server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", default=8787, type=int, help="Bind port (default: 8787)")
    return parser.parse_args()


def main() -> None:
    load_env_file(ROOT_DIR / ".env.local")
    load_env_file(ROOT_DIR / ".env")
    args = parse_args()

    backend = Backend(ROOT_DIR)
    AppHandler.backend = backend
    handler_cls = partial(AppHandler, directory=str(ROOT_DIR))

    server = ThreadingHTTPServer((args.host, args.port), handler_cls)

    print(f"[dev] Serving SmartTeamTracker from {ROOT_DIR}")
    print(f"[dev] URL: http://{args.host}:{args.port}")
    if backend.mode == "supabase":
        print("[dev] API mode: supabase")
    else:
        print("[dev] API mode: local (.dev-data.json)")
        print("[dev] Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local for real DB mode")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
