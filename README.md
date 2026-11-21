# 🎛️ Stream Deck: iPhone → portátil Windows (gratis)

Ahora **todo se edita en el PC**. El móvil se pone en horizontal y solo muestra
la Stream Deck que le manda el portátil.

- **Web:** editor visual con login (✏️ en la Stream Deck) para diseñar todo.
- **PC:** daemon que ejecuta acciones y controla el volumen.
- **Nube:** Firebase (Spark, gratis): Auth + Realtime Database.
- **Móvil:** web en GitHub Pages, modo horizontal, sin botones de edición.

## Abrir

- Editor del PC: **http://localhost:8000** (solo en este equipo)
- Stream Deck del móvil: **https://giovaglc.github.io/streamdeck/**
- Usuario: `giocavallic@gmail.com` · contraseña: la del chat

## Arrancar el PC

```powershell
cd streamdeck\pc
pip install -r requirements.txt
python deck_daemon.py
```

Deja esa ventana abierta. El editor queda en `http://localhost:8000`.

---

## Editor del PC (http://localhost:8000)

### Páginas / menús
Crea páginas ("Stream", "Trabajar", "Juegos"...). Al **guardar** una página se
activa automáticamente y el móvil cambia a ella. El móvil **no tiene selector**:
lo elige el PC.

### Rejilla del móvil
- Pantalla en **horizontal**, 8 columnas de cuadrados.
- Cada control ocupa **1, 2 o 4 cuadrados**:
  - Botón: `1` = 1×1, `2` = 2×1 (ancho), `4` = 2×2.
  - Deslizador: mínimo `2` = 1×2 (barra vertical), `4` = 2×2.
- Puedes poner **color**, **emoji**, **etiqueta** e **imagen** (URL o subir archivo
  ≤ ~200 KB) en cada control.
- **Color de fondo** general de la Stream Deck.

### Funciones
En "Funciones (bindings)" se define qué hace cada `id` en el PC:
`url`, `app`, `cmd`, `volume`, `media`, `key`, `volume_master`, `volume_app`.
Se guarda en `pc/bindings.json` y se publica en Firebase.

### Ajustes
Cambio de contraseña desde el PC: actualiza Firebase y `pc/config.json` a la vez.
También puedes cambiarla desde ⚙️ en el móvil, pero entonces debes actualizar
`pc/config.json` a mano.

**Importante:** pulsa **💾 Guardar y mostrar en el móvil** después de cada cambio
de layout, y **💾 Guardar funciones** después de cambiar bindings.

---

## Móvil

- Se abre en **horizontal**; en vertical aparece un aviso para girar.
- Muestra solo la rejilla, el nombre de la página actual y un punto de estado del PC.
- ⚙️ Ajustes: cambiar rol (Envío/Recepción), cambiar contraseña y salir.
- No hay edición en el móvil: todo viene del PC por Realtime Database.

## Datos en Firebase

```
decks/<uid>/
  layout         ← PC (páginas, background, controles, tamaños, imágenes)
  bindings       ← PC (acciones)
  audio          ← PC (volumen real)
  desiredAudio   ← móvil (volumen deseado)
  presence       ← PC (rol, equipo, lastSeen)
  commands/      ← móvil (órdenes; el PC las ejecuta y borra)
  trustedDevices/← móvil
```

## Coste y límites

Todo gratis: GitHub Pages (repo público), Firebase Spark, Python de código abierto.
Sin túnel, sin dominio y sin tarjeta. El PC debe estar encendido con el daemon corriendo.

## Problemas

- **El móvil no cambia:** pulsa Guardar en el editor y comprueba que el PC dice "en línea".
- **No abre el editor:** el daemon no está corriendo o el puerto 8000 está ocupado.
- **Contraseña incorrecta en el PC:** cambia la contraseña desde el editor del PC
  (o actualiza `pc/config.json`).
- **Slider no mueve el volumen:** `pip install pycaw comtypes` y reinicia el daemon.
