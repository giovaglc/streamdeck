#!/usr/bin/env python3
"""Lanzador genérico del protocolo streamdeck://.

Recibe la URL completa como argumento, lee el parámetro ?config=<ruta> y
arranca deck_daemon.py con esa configuración. Cada usuario pone su ruta en
la web; aquí solo se ejecuta lo que él indicó.
"""
import os
import subprocess
import sys
import urllib.parse

import psutil

BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE, "daemon_run.log")


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    query = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query)
    cfg = query.get("config", [""])[0] or os.path.join(BASE, "config.json")
    if not os.path.isabs(cfg):
        cfg = os.path.join(BASE, cfg)
    if not os.path.exists(cfg):
        return

    daemon = os.path.join(BASE, "deck_daemon.py")
    for p in psutil.process_iter(["cmdline"]):
        try:
            line = " ".join(p.info["cmdline"] or [])
            if "deck_daemon.py" in line and cfg in line:
                return  # ya está corriendo para esa cuenta
        except Exception:
            continue

    out = open(LOG, "a", encoding="utf-8")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(
        [sys.executable, "-u", daemon, "--config", cfg],
        cwd=BASE, stdout=out, stderr=subprocess.STDOUT, creationflags=flags,
    )


if __name__ == "__main__":
    main()
