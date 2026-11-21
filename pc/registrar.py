#!/usr/bin/env python3
"""Registra el protocolo streamdeck:// para que el botón de la web abra el .bat.

Se ejecuta UNA sola vez con «Registrar protocolo.bat».
Lee la ruta del .bat desde Ajustes (Firebase) y la escribe en el registro de Windows.
"""
import json
import os
import winreg

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, "config.json")
AUTH_KEY = "AIzaSyBi7LVOHOUTk1HxNWT_2yMvDstklvhnyaw"


def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    r = requests.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": AUTH_KEY},
        json={"email": cfg["email"], "password": cfg["password"],
              "returnSecureToken": True},
        timeout=20,
    )
    r.raise_for_status()
    auth = r.json()
    uid, token = auth["localId"], auth["idToken"]
    db = cfg.get("database_url", "https://careful-plexus-402813-default-rtdb.firebaseio.com")

    url = "%s/decks/%s/settings/batPath.json" % (db.rstrip("/"), uid)
    resp = requests.get(url, params={"auth": token}, timeout=15)
    bat = resp.json() if resp.status_code == 200 else None
    if not bat:
        bat = os.path.join(BASE, "Conectar PC.bat")
        requests.put(url, params={"auth": token}, json=bat, timeout=15)

    if not os.path.exists(bat):
        raise SystemExit("No existe el archivo: " + bat)

    root = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\streamdeck")
    winreg.SetValue(root, "", winreg.REG_SZ, "URL:Stream Deck")
    winreg.SetValueEx(root, "URL Protocol", 0, winreg.REG_SZ, "")
    cmd = winreg.CreateKey(root, r"shell\open\command")
    winreg.SetValue(cmd, "", winreg.REG_SZ, '"%s"' % bat)
    winreg.CloseKey(cmd)
    winreg.CloseKey(root)

    print("Protocolo streamdeck:// registrado para:")
    print("  " + bat)
    print("Ya puedes pulsar «Conectar PC» en la web.")


if __name__ == "__main__":
    main()
