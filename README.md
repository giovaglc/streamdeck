# 🎛️ Stream Deck: móvil → portátil Windows (gratis)

- **Web:** editor y Stream Deck con login (GitHub Pages). Cada cuenta ve su propio deck.
- **PC:** `deck_daemon.py` ejecuta acciones y controla el volumen.
- **Firebase:** Spark gratis, Auth + Realtime Database.

Web: **https://giovaglc.github.io/streamdeck/**

## Conectar el PC desde la web (cualquier usuario)

1. **Una sola vez** en el portátil: doble clic en `pc/Registrar protocolo.bat`.
   Eso registra el protocolo `streamdeck://` que permite a la web abrir el daemon.
2. Crea tu configuración: copia `pc/config.example.json` a `pc/config-<tu-nombre>.json`
   y pon tu correo y contraseña de Firebase.
3. En la web, ⚙️ → **Conectar PC desde la web** → pega la ruta de **tu** `.json`
   → **Guardar ruta**.
4. Pulsa **🚀 Conectar PC**. Arranca tu daemon con tu cuenta.

El botón es el mismo para todos: cada usuario pone su propia ruta. Cada cuenta
tiene su propio layout y sus funciones en `bindings-<nombre>.json`. Los datos
están separados por UID de Firebase.

Para parar el daemon, cierra su ventana o pulsa Ctrl+C.

## Uso

- En el móvil: rejilla **7 × 3** en horizontal; botones y deslizadores verticales.
- ⚙️ en la web: rol Envío/Recepción, ruta de configuración, cambiar contraseña, salir.
- ✏️ en la web: editor visual (páginas, colores, imágenes, tamaños 1/2/4, funciones).
- Las páginas las activa el editor; el móvil muestra solo lo que dice el PC.

## Datos

```
decks/<uid>/
  layout          ← editor web
  bindings        ← funciones del usuario
  audio / desiredAudio / presence / commands
  settings/configPath  ← ruta del .json de ese usuario
```

## Coste

Todo gratis: GitHub Pages, Firebase Spark, Python. Sin túneles ni tarjeta.
El PC debe estar encendido y con el daemon corriendo.

## Problemas

- **No conecta:** revisa la ruta en ⚙️ y que el protocolo esté registrado (`Registrar protocolo.bat`).
- **PC desconectado:** el daemon de esa cuenta no está corriendo.
- **Sliders sin efecto:** `pip install -r pc/requirements.txt` y reinicia.
