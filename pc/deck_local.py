#!/usr/bin/env python3
"""Stream Deck local: el móvil habla directamente con el PC por WiFi.

Sin Firebase, sin login. El PC sirve la web en http://<IP>:8000, ejecuta las
acciones y manda cambios al móvil por Server-Sent Events.

El móvil se empareja una sola vez con el código que muestra /admin.
"""
import json
import os
import queue
import random
import socket
import string
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import deck_daemon as core

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "local")
STATE_FILE = os.path.join(BASE, "local_state.json")
PORT = 8000

DEFAULT_LAYOUT = {
    "background": "#10131a",
    "active": "Stream",
    "profiles": {
        "Stream": {"keys": [
            {"id": "youtube", "type": "button", "label": "YouTube", "icon": "▶️", "color": "#ff0033", "image": "", "span": 1},
            {"id": "spotify", "type": "button", "label": "Spotify", "icon": "🎵", "color": "#1db954", "image": "", "span": 1},
            {"id": "playpause", "type": "button", "label": "Play/Pausa", "icon": "⏯️", "color": "#8e44ad", "image": "", "span": 1},
            {"id": "next", "type": "button", "label": "Siguiente", "icon": "⏭️", "color": "#8e44ad", "image": "", "span": 1},
            {"id": "prev", "type": "button", "label": "Anterior", "icon": "⏮️", "color": "#8e44ad", "image": "", "span": 1},
            {"id": "master", "type": "slider", "label": "Volumen", "icon": "🔊", "color": "#2980b9", "image": "", "target": "master", "span": 2},
            {"id": "sp_vol", "type": "slider", "label": "Vol Spotify", "icon": "🎵", "color": "#1db954", "image": "", "target": "Spotify.exe", "span": 2},
            {"id": "mute", "type": "button", "label": "Silenciar", "icon": "🔇", "color": "#7f8c8d", "image": "", "span": 1},
            {"id": "lock", "type": "button", "label": "Bloquear", "icon": "🔒", "color": "#c0392b", "image": "", "span": 1},
        ]},
    },
}

DEFAULT_BINDINGS = {
    "youtube": {"type": "url", "value": "https://www.youtube.com"},
    "spotify": {"type": "app", "value": os.path.join(os.environ.get("APPDATA", ""), "Spotify", "Spotify.exe")},
    "playpause": {"type": "media", "value": "playpause"},
    "next": {"type": "media", "value": "next"},
    "prev": {"type": "media", "value": "prev"},
    "mute": {"type": "media", "value": "mute"},
    "lock": {"type": "cmd", "value": "rundll32.exe user32.dll,LockWorkStation"},
    "explorer": {"type": "app", "value": "explorer.exe"},
    "cmd": {"type": "app", "value": "cmd.exe"},
    "master": {"type": "volume_master"},
    "sp_vol": {"type": "volume_app", "value": "Spotify.exe", "level": 70},
}


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            s = json.load(open(STATE_FILE, encoding="utf-8"))
        except Exception:
            s = {}
    else:
        s = {}
    s.setdefault("layout", DEFAULT_LAYOUT)
    s.setdefault("bindings", DEFAULT_BINDINGS)
    s.setdefault("desiredAudio", {"master": 50, "apps": {}})
    s.setdefault("audio", {"master": 50, "apps": {}})
    s.setdefault("tokens", [])
    if not s.get("code"):
        s["code"] = "".join(random.choice(string.digits) for _ in range(6))
    s["layout"] = core.normalize_layout(s["layout"])
    save_state(s)
    return s


def save_state(s):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)


STATE = load_state()
CLIENTS = []
last_applied = {}


def broadcast():
    payload = json.dumps({
        "layout": STATE["layout"],
        "bindings": STATE["bindings"],
        "audio": STATE["audio"],
        "presence": {"online": True, "device": socket.gethostname()},
    }, ensure_ascii=False)
    for q in list(CLIENTS):
        try:
            q.put_nowait(payload)
        except Exception:
            pass


def audio_loop():
    global last_applied
    while True:
        try:
            desired = STATE.get("desiredAudio") or {}
            master = desired.get("master")
            if master is not None and last_applied.get("master") != master:
                core.set_master_volume(int(master))
                last_applied["master"] = master
            for proc, level in (desired.get("apps") or {}).items():
                key = "app:" + str(proc).lower()
                if last_applied.get(key) != level:
                    if core.set_app_volume(proc, int(level)):
                        last_applied[key] = level
            actual = core.real_audio_state()
            if actual != STATE.get("audio"):
                STATE["audio"] = actual
                broadcast()
        except Exception as exc:
            print("[audio]", type(exc).__name__, str(exc)[:100])
        time.sleep(2)


class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(data)
        except Exception:
            pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def _token(self):
        from urllib.parse import urlparse, parse_qs
        return parse_qs(urlparse(self.path).query).get("token", [""])[0]

    def _auth(self):
        return self._token() in STATE.get("tokens", [])

    def _file(self, name, ctype):
        try:
            self._send(200, open(os.path.join(WEB, name), encoding="utf-8").read(), ctype)
        except Exception as exc:
            self._send(500, str(exc), "text/plain; charset=utf-8")

    def do_GET(self):
        from urllib.parse import urlparse
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._file("index.html", "text/html; charset=utf-8")
        elif path == "/styles.css":
            self._file("styles.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self._file("app.js", "application/javascript; charset=utf-8")
        elif path == "/admin":
            ip = get_ip()
            html = ("<!doctype html><meta charset=utf-8><title>Stream Deck · PC</title>"
                    "<body style='font:16px system-ui;background:#0f1115;color:#fff;padding:30px'>"
                    "<h1>🎛️ Stream Deck local</h1>"
                    "<p>Abre en el móvil (misma WiFi):</p>"
                    "<h2 style='color:#7fb3ff'>http://%s:%d</h2>"
                    "<p>Código de emparejamiento:</p>"
                    "<h1 style='font-size:52px;letter-spacing:8px;color:#2ecc71'>%s</h1>"
                    "<p>Dispositivos emparejados: %d</p></body>" % (ip, PORT, STATE["code"], len(STATE["tokens"])))
            self._send(200, html, "text/html; charset=utf-8")
        elif path == "/api/state":
            if not self._auth():
                self._json({"error": "no autorizado"}, 401)
            else:
                self._json({"layout": STATE["layout"], "bindings": STATE["bindings"],
                            "audio": STATE["audio"], "code": STATE["code"]})
        elif path == "/api/events":
            if not self._auth():
                self._json({"error": "no autorizado"}, 401)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q = queue.Queue()
            CLIENTS.append(q)
            try:
                self.wfile.write(("data: " + json.dumps({
                    "layout": STATE["layout"], "bindings": STATE["bindings"],
                    "audio": STATE["audio"]}, ensure_ascii=False) + "\n\n").encode("utf-8"))
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=20)
                    except queue.Empty:
                        msg = "{}"
                    self.wfile.write(("data: " + msg + "\n\n").encode("utf-8"))
                    self.wfile.flush()
            except Exception:
                pass
            finally:
                if q in CLIENTS:
                    CLIENTS.remove(q)
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        from urllib.parse import urlparse
        path = urlparse(self.path).path
        try:
            data = self._body()
            if path == "/api/pair":
                if str(data.get("code", "")).strip() != STATE["code"]:
                    self._json({"ok": False, "error": "código incorrecto"}, 403)
                    return
                token = "t" + "".join(random.choice(string.ascii_letters + string.digits) for _ in range(24))
                STATE["tokens"].append(token)
                save_state(STATE)
                self._json({"ok": True, "token": token})
            elif not self._auth():
                self._json({"error": "no autorizado"}, 401)
            elif path == "/api/command":
                key_id = data.get("keyId")
                action = STATE["bindings"].get(key_id)
                if action:
                    print("[▶]", key_id, "->", json.dumps(action, ensure_ascii=False))
                    core.run_action(action)
                else:
                    print("[!] sin función:", key_id)
                self._json({"ok": bool(action)})
            elif path == "/api/audio":
                desired = STATE.get("desiredAudio") or {}
                if "master" in data:
                    desired["master"] = int(data["master"])
                if isinstance(data.get("apps"), dict):
                    desired.setdefault("apps", {}).update(data["apps"])
                STATE["desiredAudio"] = desired
                save_state(STATE)
                broadcast()
                self._json({"ok": True})
            elif path == "/api/layout":
                STATE["layout"] = core.normalize_layout(data.get("layout") or {})
                save_state(STATE)
                broadcast()
                self._json({"ok": True})
            elif path == "/api/bindings":
                STATE["bindings"] = data.get("bindings") or {}
                save_state(STATE)
                broadcast()
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as exc:
            self._json({"ok": False, "error": str(exc)}, 500)


def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    threading.Thread(target=audio_loop, daemon=True).start()
    print("=" * 56)
    print(" Stream Deck LOCAL")
    print(" Móvil (misma WiFi): http://%s:%d" % (get_ip(), PORT))
    print(" Panel del PC:       http://localhost:%d/admin" % PORT)
    print(" Código: %s" % STATE["code"])
    print(" Ctrl+C para parar")
    print("=" * 56)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
