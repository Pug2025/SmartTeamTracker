#!/usr/bin/env python3
"""Local dev server for SmartTeamTracker.

Serves static files and emulates the Vercel /api routes:
- /api/ping
- /api/save-game
- /api/games
- /api/live-game

Modes:
- Supabase mode: when SUPABASE_URL and SUPABASE_ANON_KEY are set.
- Local mode: fallback JSON store in .dev-data.json (good for offline dev/test).
"""

from __future__ import annotations

import argparse
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
