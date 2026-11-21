# 🎛️ Stream Deck: iPhone → portátil Windows (gratis)

Un Stream Deck en la nube: abres una web en `https://giovaglc.github.io/streamdeck/`,
haces login con **correo y contraseña**, y el portátil **se empareja solo** porque
usa la misma cuenta. No hay IP, no hay códigos, no hay túneles.

- **Móvil:** diseña botones y deslizadores (GitHub Pages, estático).
- **Nube:** Supabase (plan gratuito) guarda la sesión, el layout y las órdenes.
- **PC:** un daemon de Python ejecuta las acciones y controla el volumen real.

Coste: **0 €** (GitHub + Supabase free + Python).

---

## Estructura

```
streamdeck/
├── docs/                    ← se publica en GitHub Pages
│   ├── index.html
│   ├── styles.css
│   ├── config.js            ← pega aquí URL y anon key de Supabase (público)
│   └── app.js
├── pc/                      ← se ejecuta en Windows
│   ├── deck_daemon.py
│   ├── config.example.json  ← copiar a config.json y rellenar
│   ├── bindings.example.json← copiar a bindings.json y editar
│   └── requirements.txt
├── supabase/schema.sql      ← ejecutar una vez en Supabase
└── .gitignore
```

---

## 1. Supabase (una sola vez)

1. Crea un proyecto gratis en **supabase.com**.
2. En **SQL Editor → New query**, pega todo `supabase/schema.sql` y dale a **Run**.
3. En **Authentication → Providers → Email**, asegúrate de que esté activado.
   - Si no quieres confirmar correos: **Authentication → Providers → Email →
     Confirm email = OFF**.
4. En **Authentication → Users → Add user**, crea tu usuario con correo y contraseña.
5. En **Project Settings → API**, copia:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon public key** → la clave larga `eyJ...`

> La anon key es pública por diseño: va en `docs/config.js` y se sube a GitHub
> sin problema. La *service_role* no se usa en este proyecto.

## 2. GitHub Pages

1. Sube esta carpeta a un repo de GitHub.
2. Edita `docs/config.js` y pega tu URL y anon key:
   ```js
   window.DECK_CONFIG = {
     SUPABASE_URL: 'https://xxxx.supabase.co',
     SUPABASE_ANON_KEY: 'eyJ...'
   };
   ```
3. En el repo: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: `main`, carpeta: **`/docs`**
4. Guarda. Tu web será `https://giovaglc.github.io/streamdeck/`.

## 3. Portátil Windows

```powershell
cd streamdeck\pc
pip install -r requirements.txt
copy config.example.json config.json
copy bindings.example.json bindings.json
```

Edita `pc/config.json` con la misma URL, la anon key y **el mismo correo y
contraseña** del paso 1:

```json
{
  "supabase_url": "https://xxxx.supabase.co",
  "supabase_anon_key": "eyJ...",
  "email": "tu@correo.com",
  "password": "tu-contrasena",
  "poll_ms": 300
}
```

Arranca el daemon:

```powershell
python deck_daemon.py
```

Deja esa ventana abierta. **No abre ningún puerto**: solo sale a Internet.

## 4. iPhone

1. Abre la URL de GitHub Pages en Safari.
2. Pon correo y contraseña → **Entrar**.
3. Marca **Recordar este dispositivo** para no volver a escribirlos.
   - Marcado → sesión en `localStorage` (sobrevive a cerrar Safari).
   - Sin marcar → sesión en `sessionStorage` (se pierde al cerrar la pestaña).
   - El device id se registra en la tabla `trusted_devices`.

¡Ya está! El móvil y el PC comparten `decks/<tu-uid>` y se ven solos.

---

## Uso

### Diseñar en el móvil
Pulsa **Editar** → toca un control para cambiar etiqueta, emoji, color y tipo,
o añade/borra controles. Hay **perfiles** (p. ej. "Juego" / "Trabajo") con layouts distintos.

Tipos de control:
- **Botón:** envía una orden con su `id`.
- **Deslizador:** elige `master` para el volumen general o el nombre del proceso
  (p. ej. `Spotify.exe`, `chrome.exe`) para el volumen de esa app.

### Darle función en el PC
Edita `pc/bindings.json` con el `id` de cada botón:

```json
{
  "youtube":  { "type": "url", "value": "https://www.youtube.com" },
  "spotify":  { "type": "url", "value": "https://open.spotify.com" },
  "explorer": { "type": "app", "value": "explorer.exe" },
  "playpause":{ "type": "media", "value": "playpause" },
  "mute":     { "type": "media", "value": "mute" },
  "lock":     { "type": "cmd", "value": "rundll32.exe user32.dll,LockWorkStation" },
  "atajo":    { "type": "key", "value": "ctrl+shift+p" }
}
```

El daemon **detecta cambios en el archivo y los recarga sin reiniciar**.
Los botones sin función se ven atenuados en el móvil.

Tipos de acción: `url`, `app`, `cmd`, `volume` (`up2`, `down3`, `mute`),
`media` (`playpause`, `next`, `prev`, `stop`), `key` (`ctrl+shift+p`, `win+r`).

### Volumen en tiempo real
- El móvil escribe el valor deseado en `desired_audio`.
- El daemon lo aplica con **pycaw**: general y por aplicación.
- El daemon publica el volumen **real** en `audio`; Supabase Realtime lo envía al
  móvil, así que el slider se mueve también si cambias el volumen desde el teclado.

---

## Seguridad y límites

- Las reglas RLS de Supabase solo permiten a cada usuario leer/escribir su propio
  `user_id`. Nadie más ve tu deck.
- La contraseña del usuario se guarda solo en `pc/config.json` (ignorado por Git).
  No subas ese archivo.
- Plan free de Supabase: más que suficiente para uso personal.
- El PC debe estar **encendido** y con el daemon corriendo.
- La latencia típica es 100–300 ms; en los sliders se suaviza con un pequeño retardo.

## Solución de problemas

- **"PC desconectado":** el daemon no está corriendo o falló el login. Mira su terminal.
- **No entra en la web:** revisa la anon key en `docs/config.js` y que el usuario
  exista y esté confirmado.
- **Los sliders no mueven el volumen:** `pip install pycaw comtypes` y reinicia el daemon.
- **El volumen por app no aparece:** el nombre en el slider debe coincidir con el
  proceso real (p. ej. `Spotify.exe`). Abre la app y reproduce algo para que exista
  la sesión de audio.
- **Los botones se ven atenuados:** ese `id` no tiene entrada en `bindings.json`.
