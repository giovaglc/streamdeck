#!/usr/bin/env python3
"""Stream Deck - daemon de Windows (Firebase Auth + Realtime Database).

Se conecta con tu cuenta de correo/contraseña, lee el layout que diseñas en el
móvil, ejecuta las acciones de bindings.json y publica el volumen real.

No abre ningún puerto: solo conexiones salientes a Firebase.
"""
import ctypes
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
EXAMPLE_CONFIG = os.path.join(BASE_DIR, "config.example.json")
BINDINGS_PATH = os.path.join(BASE_DIR, "bindings.json")
EXAMPLE_BINDINGS = os.path.join(BASE_DIR, "bindings.example.json")

# ---------------------------------------------------------------- audio (pycaw)
try:
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume, ISimpleAudioVolume
    from comtypes import CLSCTX_ALL
    PYCAW = True
except Exception as exc:
    PYCAW = False
    print("[aviso] pycaw no disponible (%s). Los sliders no funcionarán." % exc)

# ---------------------------------------------------------------- teclado
MODS = {"ctrl": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B}
SPECIAL = {
    "enter": 0x0D, "esc": 0x1B, "space": 0x20, "tab": 0x09, "backspace": 0x08,
    "delete": 0x2E, "insert": 0x2D, "up": 0x26, "down": 0x28,
    "left": 0x25, "right": 0x27, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22,
    "playpause": 0xB3, "next": 0xB0, "prev": 0xB1, "stop": 0xB2,
    "volup": 0xAF, "voldown": 0xAE, "mute": 0xAD,
}


def _vk(key):
    k = str(key).strip().lower()
    if k in MODS:
        return MODS[k]
    if k in SPECIAL:
        return SPECIAL[k]
    if len(k) == 1 and k.isalpha():
        return ord(k.upper())
    if len(k) == 1 and k.isdigit():
        return ord(k)
    if k.startswith("f") and k[1:].isdigit() and 1 <= int(k[1:]) <= 24:
        return 0x6F + int(k[1:])
    return None


def _event(vk, up=False):
    if sys.platform == "win32" and vk:
        ctypes.windll.user32.keybd_event(vk, 0, 0x0002 if up else 0, 0)


def tap(vk):
    _event(vk, False)
    _event(vk, True)


def send_combo(combo):
    parts = [p for p in str(combo).replace("+", " + ").split() if p != "+"]
    mods, key = [], None
    for p in parts:
        vk = _vk(p)
        if vk is None:
            continue
        if p.lower() in MODS:
            mods.append(vk)
        else:
            key = vk
    if key is None:
        return False
    for m in mods:
        _event(m, False)
    tap(key)
    for m in reversed(mods):
        _event(m, True)
    return True


def handle_volume_steps(value):
    v = str(value).lower()
    if "mute" in v:
        tap(SPECIAL["mute"])
        return
    digits = "".join(c for c in v if c.isdigit())
    n = int(digits) if digits else 1
    if "up" in v:
        for _ in range(n):
            tap(SPECIAL["volup"])
    elif "down" in v:
        for _ in range(n):
            tap(SPECIAL["voldown"])


# ---------------------------------------------------------------- volumen real
def _master_endpoint():
    """Compatible con pycaw antiguo y nuevo (AudioDevice.EndpointVolume)."""
    device = AudioUtilities.GetSpeakers()
    if hasattr(device, "EndpointVolume"):
        return device, device.EndpointVolume
    iface = device.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return device, iface.QueryInterface(IAudioEndpointVolume)


def get_master_volume():
    if not PYCAW:
        return None
    try:
        device, vol = _master_endpoint()
        if hasattr(device, "volume_percent") and device.volume_percent is not None:
            return round(device.volume_percent)
        return round(vol.GetMasterVolumeLevelScalar() * 100)
    except Exception as exc:
        print("[audio] master:", exc)
        return None


def set_master_volume(level):
    if not PYCAW:
        return False
    try:
        level = max(0, min(100, int(level)))
        device, vol = _master_endpoint()
        if hasattr(device, "volume_percent"):
            device.volume_percent = level
        else:
            vol.SetMasterVolumeLevelScalar(level / 100.0, None)
        return True
    except Exception as exc:
        print("[audio] set master:", exc)
        return False


def safe_key(name):
    """Firebase RTDB no permite . # $ [ ] / en las claves."""
    s = str(name).strip().lower()
    for ch in '.#$[]/':
        s = s.replace(ch, '_')
    return s


def audio_sessions():
    out = {}
    if not PYCAW:
        return out
    try:
        sessions = AudioUtilities.GetAllSessions()
    except Exception as exc:
        print("[audio] sesiones:", exc)
        return out
    for session in sessions:
        try:
            proc = session.Process
            if not proc:
                continue
            name = proc.name()
            ctl = getattr(session, "SimpleAudioVolume", None)
            if ctl is None:
                ctl = session._ctl.QueryInterface(ISimpleAudioVolume)
            out[safe_key(name)] = (name, ctl, round(ctl.GetMasterVolume() * 100))
        except Exception:
            continue
    return out


def set_app_volume(process, level):
    if not PYCAW:
        return False
    target = safe_key(process)
    for low, (_real, ctl, _cur) in audio_sessions().items():
        if low == target or low.startswith(target):
            try:
                ctl.SetMasterVolume(max(0, min(100, level)) / 100.0, None)
                return True
            except Exception as exc:
                print("[audio] set app:", exc)
    return False


def real_audio_state():
    apps = {}
    for low, (_real, _ctl, vol) in audio_sessions().items():
        apps[low] = vol
    return {"master": get_master_volume(), "apps": apps}


# ---------------------------------------------------------------- acciones
def run_action(action):
    if not isinstance(action, dict):
        return
    t = str(action.get("type", "")).lower()
    v = action.get("value", "")
    try:
        if t == "url":
            webbrowser.open(v)
        elif t == "app":
            if sys.platform == "win32":
                os.startfile(v)
            else:
                subprocess.Popen(v, shell=True)
        elif t == "cmd":
            subprocess.Popen(v, shell=True)
        elif t == "volume":
            handle_volume_steps(v)
        elif t == "media":
            vk = SPECIAL.get(str(v).lower())
            if vk:
                tap(vk)
        elif t == "key":
            send_combo(v)
        elif t == "volume_master":
            set_master_volume(int(action.get("level", v if v != "" else 50)))
        elif t == "volume_app":
            set_app_volume(v, int(action.get("level", 50)))
        else:
            print("[accion] tipo desconocido:", t)
    except Exception as exc:
        print("[accion] error:", action, "->", exc)


# ---------------------------------------------------------------- Firebase REST
class Firebase:
    def __init__(self, api_key, database_url, email, password):
        self.api_key = api_key
        self.base = database_url.rstrip("/") + "/decks"
        self.email = email
        self.password = password
        self.token = None
        self.refresh_token = None
        self.uid = None
        self.http = requests.Session()

    def _auth_error(self, response):
        if response.status_code in (401, 403):
            return True
        try:
            return "auth" in (response.json().get("error") or "").lower()
        except Exception:
            return False

    def init(self):
        """Usa el refresh token guardado; si no, hace login con contraseña."""
        cfg = load_json(CONFIG_PATH, EXAMPLE_CONFIG)
        saved = cfg.get("refresh_token")
        if saved:
            self.refresh_token = saved
            try:
                self.renew()
                self.uid = self.uid or "unknown"
                # renovar no devuelve uid: lo sacamos del token
                self.uid = self._uid_from_token()
                print("[auth] sesión renovada con token guardado")
                return
            except Exception:
                pass
        self.login()

    def _uid_from_token(self):
        import base64
        payload = self.token.split('.')[1]
        payload += '=' * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload).decode('utf-8'))
        return data.get('user_id') or data.get('sub')

    def _save_refresh(self):
        try:
            cfg = load_json(CONFIG_PATH, EXAMPLE_CONFIG)
            cfg["refresh_token"] = self.refresh_token
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
        except Exception as exc:
            print("[auth] no pudo guardar refresh token:", exc)

    def login(self):
        r = self.http.post(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
            params={"key": self.api_key},
            json={"email": self.email, "password": self.password, "returnSecureToken": True},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        self.token = data["idToken"]
        self.refresh_token = data.get("refreshToken")
        self.uid = data["localId"]
        self._save_refresh()
        print("[auth] sesión iniciada como", self.email)

    def renew(self):
        try:
            if self.refresh_token:
                r = self.http.post(
                    "https://securetoken.googleapis.com/v1/token",
                    params={"key": self.api_key},
                    json={"grant_type": "refresh_token", "refresh_token": self.refresh_token},
                    timeout=20,
                )
                r.raise_for_status()
                data = r.json()
                self.token = data["access_token"]
                self.refresh_token = data.get("refresh_token", self.refresh_token)
                self._save_refresh()
                return
        except Exception:
            pass
        self.login()

    def url(self, path=""):
        return "%s/%s%s.json?auth=%s" % (self.base, self.uid, path, self.token)

    def request(self, method, path="", **kwargs):
        url = self.url(path)
        r = self.http.request(method, url, timeout=20, **kwargs)
        if self._auth_error(r):
            self.renew()
            r = self.http.request(method, self.url(path), timeout=20, **kwargs)
        return r

    def get_deck(self):
        r = self.request("GET")
        if r.status_code != 200:
            print("[firebase] get:", r.status_code, r.text[:200])
            return {}
        return r.json() or {}

    def patch(self, fields):
        r = self.request("PATCH", json=fields)
        if r.status_code not in (200, 204):
            print("[firebase] patch:", r.status_code, r.text[:200])

    def delete(self, path):
        r = self.request("DELETE", path)
        if r.status_code not in (200, 204):
            print("[firebase] delete:", r.status_code, r.text[:200])

    def change_password(self, new_password):
        """Cambia la contraseña del usuario (login fresco para evitar token viejo)."""
        self.login()
        r = self.http.post(
            "https://identitytoolkit.googleapis.com/v1/accounts:update",
            params={"key": self.api_key},
            json={"idToken": self.token, "password": new_password,
                  "returnSecureToken": True},
            timeout=20,
        )
        if r.status_code != 200:
            raise RuntimeError(r.text[:300])
        self.password = new_password
        data = r.json()
        self.token = data.get("idToken", self.token)
        self.refresh_token = data.get("refreshToken", self.refresh_token)
        cfg = load_json(CONFIG_PATH, EXAMPLE_CONFIG)
        cfg["password"] = new_password
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        return True


def normalize_layout(layout):
    """Asegura que el layout tenga los campos nuevos (background, sizes, etc.)."""
    layout = layout if isinstance(layout, dict) else {}
    layout.setdefault("background", "#0f1115")
    profiles = layout.get("profiles")
    if not isinstance(profiles, dict) or not profiles:
        profiles = {"Stream": {"keys": []}}
    for page in profiles.values():
        if not isinstance(page, dict):
            continue
        keys = page.get("keys")
        if isinstance(keys, dict):
            keys = [v for k, v in sorted(
                keys.items(),
                key=lambda kv: int(kv[0]) if str(kv[0]).lstrip('-').isdigit() else 0
            ) if str(k).lstrip('-').isdigit() and int(k) >= 0 and isinstance(v, dict)]
        if not isinstance(keys, list):
            keys = []
        keys = [item for item in keys if isinstance(item, dict)]
        page["keys"] = keys
        for idx, item in enumerate(keys):
            item.setdefault("id", "k%d" % idx)
            item.setdefault("type", "button")
            span = item.get("span", 2 if item["type"] == "slider" else 1)
            try:
                span = int(span)
            except Exception:
                span = 1
            if span not in (1, 2, 4):
                span = 1
            if item["type"] == "slider" and span < 2:
                span = 2
            item["span"] = span
            item.setdefault("label", "")
            item.setdefault("icon", "")
            item.setdefault("color", "#34495e")
            item.setdefault("image", "")
            item.setdefault("target", "master")
    layout["profiles"] = profiles
    if not profiles.get(layout.get("active")):
        layout["active"] = next(iter(profiles))
    return layout


# ---------------------------------------------------------------- config
def load_json(path, example):
    if not os.path.exists(path):
        if os.path.exists(example):
            with open(example, "r", encoding="utf-8") as f:
                content = f.read()
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            print("Se ha creado", os.path.basename(path), "copiando el example.")
            print("¡Edítalo con tus datos antes de seguir!")
            sys.exit(1)
        raise SystemExit("Falta el archivo " + path)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_bindings():
    try:
        with open(BINDINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


# ---------------------------------------------------------------- bucle
def main():
    global CONFIG_PATH, BINDINGS_PATH

    # Permitir varios daemons en el mismo PC: uno por cuenta.
    #   python deck_daemon.py --config config-mama.json
    config_arg = None
    if '--config' in sys.argv:
        i = sys.argv.index('--config')
        if i + 1 < len(sys.argv):
            config_arg = sys.argv[i + 1]
    if config_arg:
        CONFIG_PATH = config_arg if os.path.isabs(config_arg) else os.path.join(BASE_DIR, config_arg)
        name = os.path.basename(CONFIG_PATH)
        stem = name[7:-5] if name.startswith('config-') and name.endswith('.json') else 'custom'
        BINDINGS_PATH = os.path.join(BASE_DIR, 'bindings-%s.json' % stem)

    cfg = load_json(CONFIG_PATH, EXAMPLE_CONFIG)
    load_json(BINDINGS_PATH, EXAMPLE_BINDINGS)

    fb = Firebase(cfg["firebase_api_key"], cfg["database_url"], cfg["email"], cfg["password"])
    fb.init()

    poll = float(cfg.get("poll_ms", 300)) / 1000.0
    bindings = load_bindings()
    last_bindings_hash = json.dumps(bindings, sort_keys=True)
    last_applied = {}
    last_audio_publish = 0
    last_presence = 0
    last_audio = None
    processed = set()

    print("=" * 58)
    print(" Stream Deck daemon en marcha")
    print(" Edita la web: https://giovaglc.github.io/streamdeck/")
    print(" Ctrl+C para parar.")
    print("=" * 58)

    while True:
        try:
            deck = fb.get_deck()
            now = time.time()

            if deck:
                remote = deck.get("bindings")
                if isinstance(remote, dict) and remote:
                    bh = json.dumps(remote, sort_keys=True)
                    if bh != last_bindings_hash:
                        bindings = remote
                        last_bindings_hash = bh
                        with open(BINDINGS_PATH, "w", encoding="utf-8") as f:
                            json.dump(bindings, f, indent=2, ensure_ascii=False)
                        print("[bindings] actualizados desde la web")

                desired = deck.get("desiredAudio") or {}
                master = desired.get("master")
                if master is not None and last_applied.get("master") != master:
                    ok = set_master_volume(int(master))
                    print("[audio] aplicar master", master, "->", ok)
                    last_applied["master"] = master
                for proc, level in (desired.get("apps") or {}).items():
                    key = "app:" + str(proc).lower()
                    if last_applied.get(key) != level:
                        if set_app_volume(proc, int(level)):
                            last_applied[key] = level

                if now - last_audio_publish > 1.0:
                    actual = real_audio_state()
                    if actual != last_audio:
                        print("[audio] publicar", actual)
                        fb.patch({"audio": actual})
                        last_audio = actual
                    last_audio_publish = now

                if now - last_presence > 8.0:
                    fb.patch({"presence": {
                        "online": True,
                        "role": "receiver",
                        "device": socket.gethostname(),
                        "lastSeen": int(now * 1000),
                    }})
                    last_presence = now

            commands = deck.get("commands") or {}
            for cmd_id, payload in commands.items():
                if cmd_id in processed or not isinstance(payload, dict):
                    continue
                processed.add(cmd_id)
                key_id = payload.get("keyId")
                action = bindings.get(key_id)
                if action:
                    print("[▶]", key_id, "->", action.get("type"))
                    run_action(action)
                else:
                    print("[!] botón sin función:", key_id)
                fb.delete("/commands/" + cmd_id)

        except KeyboardInterrupt:
            print("\nParado.")
            break
        except Exception as exc:
            # evita volcar tokens en el log si Firebase no responde
            print("[error]", type(exc).__name__, str(exc)[:120])
            time.sleep(2)

        time.sleep(poll)


if __name__ == "__main__":
    main()
