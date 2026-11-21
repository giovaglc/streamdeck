# 🎛️ Stream Deck: iPhone → portátil Windows (gratis)

Un Stream Deck en la nube: abres **https://giovaglc.github.io/streamdeck/**, haces
login con correo y contraseña y el portátil **se empareja solo** porque usa la
misma cuenta. No hay IP, códigos ni túneles.

- **Móvil:** diseñas botones y deslizadores (GitHub Pages, estático).
- **Nube:** Firebase (plan Spark gratuito): Auth + Realtime Database.
- **PC:** un daemon de Python ejecuta acciones y controla el volumen real.

Coste: **0 €**.

## Proyecto Firebase ya creado

- Proyecto: **My First Project** → ID `careful-plexus-402813` (plan Spark)
- Usuario: `giocavallic@gmail.com`
- Contraseña: `Deck-Movil-2026!` (cámbiala en Firebase Console → Authentication → Users si quieres)
- Realtime Database: `https://careful-plexus-402813-default-rtdb.firebaseio.com`
- Reglas publicadas (en `firebase/rules.json`): cada usuario solo ve su propio `decks/<uid>`

La configuración web (clave pública) está en `docs/config.js`.

## Estructura

```
docs/                    → GitHub Pages
  index.html, styles.css, app.js, config.js
pc/                      → daemon de Windows
  deck_daemon.py
  config.example.json    → plantilla (NO contiene la contraseña)
  bindings.example.json  → plantilla de funciones
  requirements.txt
firebase/rules.json      → copia de las reglas de seguridad
```

---

## Puesta en marcha

### 1. Portátil Windows

```powershell
cd streamdeck\pc
pip install -r requirements.txt
```

Ya existe `pc/config.json` con los datos reales (está en `.gitignore`, **no se sube**).
Y `pc/bindings.json` con las funciones de ejemplo. Arranca:

```powershell
python deck_daemon.py
```

Deja la ventana abierta. No abre ningún puerto: solo sale a Firebase.

### 2. iPhone

Abre **https://giovaglc.github.io/streamdeck/**, pon:

- Correo: `giocavallic@gmail.com`
- Contraseña: `Deck-Movil-2026!`

Marca **Recordar este dispositivo** para no volver a escribirlos (sesión local persistente;
si lo desmarcas, la sesión vive solo en la pestaña).

El emparejamiento es automático: ambos comparten el mismo UID de Firebase.

---

## Uso

### Diseñar en el móvil
**Editar** → toca un control para cambiar etiqueta, emoji, color y tipo, o añade/borra.
Hay **perfiles** ("Juego", "Trabajo"…) con layouts distintos.

- **Botón:** envía una orden con su `id`.
- **Deslizador:** objetivo `master` (volumen general) o un proceso (`Spotify.exe`, `chrome.exe`).

### Darle función en el PC
Edita `pc/bindings.json` (por ejemplo el botón `youtube`):

```json
{
  "youtube":   { "type": "url", "value": "https://www.youtube.com" },
  "playpause": { "type": "media", "value": "playpause" },
  "atajo":     { "type": "key", "value": "ctrl+shift+p" },
  "master":    { "type": "volume_master" }
}
```

El daemon **recarga el archivo automáticamente** sin reiniciar. Los botones sin
función se ven atenuados en el móvil.

Tipos: `url`, `app`, `cmd`, `volume` (`up2`, `down3`, `mute`), `media`
(`playpause`, `next`, `prev`, `stop`), `key` (`ctrl+shift+p`), `volume_master`,
`volume_app` (con `"value": "Spotify.exe"`).

### Volumen en tiempo real
El móvil escribe en `desiredAudio`; el daemon lo aplica con **pycaw** (general y
por app) y publica el volumen real en `audio`. Realtime Database lo devuelve al
móvil al instante: el slider se mueve incluso si cambias el volumen desde el teclado.

---

## Datos en Firebase

```
decks/<uid>/
  layout         ← móvil
  bindings       ← PC
  audio          ← PC (volumen real)
  desiredAudio   ← móvil (volumen deseado)
  presence       ← PC (lastSeen)
  commands/      ← móvil (órdenes, el PC las borra al ejecutar)
  trustedDevices/← móvil (dispositivos recordados)
```

## Seguridad y límites

- Solo tu usuario puede leer/escribir su deck (reglas RLS de Realtime Database).
- La clave web de Firebase es pública; la contraseña vive solo en `pc/config.json`.
- Spark es gratuito: más que suficiente para uso personal.
- El PC debe estar encendido con el daemon corriendo.
- Latencia típica 100–300 ms.

## Solución de problemas

- **"PC desconectado":** el daemon no corre o falló el login. Mira su terminal.
- **No entra en la web:** revisa `docs/config.js` y que el usuario exista en
  Firebase Console → Authentication → Users.
- **Sliders sin efecto:** `pip install pycaw comtypes` y reinicia el daemon.
- **Volumen por app no aparece:** el nombre del slider debe coincidir con el
  proceso real (`Spotify.exe`). Abre la app y reproduce algo.
- **Botones atenuados:** ese `id` no tiene entrada en `bindings.json`.
