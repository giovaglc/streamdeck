#!/usr/bin/env python3
"""Panel local del PC: iniciar sesión y pulsar 'Conectar PC'.

Abre http://localhost:8000 en este equipo. El daemon se arranca solo en
segundo plano; el móvil lo detecta por Firebase al tener la misma sesión.
"""
import json
import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
import psutil

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, "config.json")
PIDFILE = os.path.join(BASE, "daemon.pid")
LOGFILE = os.path.join(BASE, "daemon_run.log")
HTMLFILE = os.path.join(BASE, "conectar.html")
AUTH_KEY = "AIzaSyBi7LVOHOUTk1HxNWT_2yMvDstklvhnyaw"

proc = None


def daemon_alive():
    try:
        pid = int(open(PIDFILE).read().strip())
        return psutil.pid_exists(pid)
    except Exception:
        return False


def save_credentials(email, password, uid=None):
    cfg = {}
    if os.path.exists(CONFIG):
        cfg = json.load(open(CONFIG, encoding="utf-8"))
    cfg["email"] = email
    cfg["password"] = password
    cfg.pop("refresh_token", None)
    if uid:
        cfg["uid"] = uid
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def sign_in(email, password):
    r = requests.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": AUTH_KEY},
        json={"email": email, "password": password, "returnSecureToken": True},
        timeout=20,
    )
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", "Error")
        except Exception:
            msg = "Error de conexión"
        return None, msg
    d = r.json()
    save_credentials(email, password, d["localId"])
    return d, None


def start_daemon():
    global proc
    if daemon_alive():
        return True, "Ya estaba conectado"
    try:
        out = open(LOGFILE, "a", encoding="utf-8")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = subprocess.Popen(
            [sys.executable, "-u", os.path.join(BASE, "deck_daemon.py")],
            cwd=BASE, stdout=out, stderr=subprocess.STDOUT,
            creationflags=flags,
        )
        with open(PIDFILE, "w") as f:
            f.write(str(proc.pid))
        return True, "Conectado"
    except Exception as exc:
        return False, str(exc)


def stop_daemon():
    try:
        pid = int(open(PIDFILE).read().strip())
        p = psutil.Process(pid)
        p.terminate()
        try:
            p.wait(3)
        except Exception:
            p.kill()
        os.remove(PIDFILE)
        return True
    except Exception:
        return False


class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, open(HTMLFILE, encoding="utf-8").read(),
                       "text/html; charset=utf-8")
        elif self.path == "/api/status":
            cfg = json.load(open(CONFIG, encoding="utf-8")) if os.path.exists(CONFIG) else {}
            self._send(200, json.dumps({
                "connected": daemon_alive(),
                "email": cfg.get("email", ""),
            }))
        else:
            self._send(404, "{}")

    def do_OPTIONS(self):
        self._send(204, "")

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
            if self.path == "/api/login":
                d, err = sign_in(data.get("email", "").strip(), data.get("password", ""))
                if err:
                    self._send(400, json.dumps({"ok": False, "error": err}))
                else:
                    self._send(200, json.dumps({"ok": True, "email": d["email"]}))
            elif self.path == "/api/connect":
                ok, msg = start_daemon()
                self._send(200, json.dumps({"ok": ok, "msg": msg}))
            elif self.path == "/api/disconnect":
                self._send(200, json.dumps({"ok": stop_daemon()}))
            else:
                self._send(404, "{}")
        except Exception as exc:
            self._send(500, json.dumps({"ok": False, "error": str(exc)}))


if __name__ == "__main__":
    print("Panel PC: http://localhost:8000")
    srv = ThreadingHTTPServer(("127.0.0.1", 8000), H)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
