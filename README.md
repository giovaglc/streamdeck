# ðŸŽ›ï¸ Stream Deck: iPhone â†’ portÃ¡til Windows (gratis)

Ahora **todo se edita en el PC**. El mÃ³vil se pone en horizontal y solo muestra
la Stream Deck que le manda el portÃ¡til.

- **Web:** editor visual con login (âœï¸ en la Stream Deck) para diseÃ±ar todo.
- **PC:** daemon que ejecuta acciones y controla el volumen.
- **Nube:** Firebase (Spark, gratis): Auth + Realtime Database.
- **MÃ³vil:** web en GitHub Pages, modo horizontal, sin botones de ediciÃ³n.

## Abrir

- Editor del PC: **http://localhost:8000** (solo en este equipo)
- Stream Deck del mÃ³vil: **https://giovaglc.github.io/streamdeck/**
- Usuario: `giova.deck@gmail.com` Â· contraseÃ±a: la del chat

## Conectar el PC desde la web

1. En la web, âš™ï¸ â†’ **Conectar PC desde la web** â†’ pega la ruta de `Conectar-PC.bat` â†’ **Guardar ruta**.
2. **Una sola vez** en el portÃ¡til: doble clic en `pc/Registrar protocolo.bat`.
3. Desde entonces, el botÃ³n **ðŸš€ Conectar PC** de la web abre el `.bat` y el daemon arranca.

TambiÃ©n puedes seguir haciendo doble clic en `pc/Conectar-PC.bat` directamente.
Para parar el daemon, cierra su ventana o pulsa Ctrl+C.

Para editar: âœï¸ en la web del mÃ³vil (o en el navegador del PC con la misma cuenta).

---

## Editor del PC (http://localhost:8000)

### PÃ¡ginas / menÃºs
Crea pÃ¡ginas ("Stream", "Trabajar", "Juegos"...). Al **guardar** una pÃ¡gina se
activa automÃ¡ticamente y el mÃ³vil cambia a ella. El mÃ³vil **no tiene selector**:
lo elige el PC.

### Rejilla del mÃ³vil
- Pantalla en **horizontal**, 8 columnas de cuadrados.
- Cada control ocupa **1, 2 o 4 cuadrados**:
  - BotÃ³n: `1` = 1Ã—1, `2` = 2Ã—1 (ancho), `4` = 2Ã—2.
  - Deslizador: mÃ­nimo `2` = 1Ã—2 (barra vertical), `4` = 2Ã—2.
- Puedes poner **color**, **emoji**, **etiqueta** e **imagen** (URL o subir archivo
  â‰¤ ~200 KB) en cada control.
- **Color de fondo** general de la Stream Deck.

### Funciones
En "Funciones (bindings)" se define quÃ© hace cada `id` en el PC:
`url`, `app`, `cmd`, `volume`, `media`, `key`, `volume_master`, `volume_app`.
Se guarda en `pc/bindings.json` y se publica en Firebase.

### Ajustes
Cambio de contraseÃ±a desde el PC: actualiza Firebase y `pc/config.json` a la vez.
TambiÃ©n puedes cambiarla desde âš™ï¸ en el mÃ³vil, pero entonces debes actualizar
`pc/config.json` a mano.

**Importante:** pulsa **ðŸ’¾ Guardar y mostrar en el mÃ³vil** despuÃ©s de cada cambio
de layout, y **ðŸ’¾ Guardar funciones** despuÃ©s de cambiar bindings.

---

## MÃ³vil

- Se abre en **horizontal**; en vertical aparece un aviso para girar.
- Muestra solo la rejilla, el nombre de la pÃ¡gina actual y un punto de estado del PC.
- âš™ï¸ Ajustes: cambiar rol (EnvÃ­o/RecepciÃ³n), cambiar contraseÃ±a y salir.
- No hay ediciÃ³n en el mÃ³vil: todo viene del PC por Realtime Database.

## Datos en Firebase

```
decks/<uid>/
  layout         â† PC (pÃ¡ginas, background, controles, tamaÃ±os, imÃ¡genes)
  bindings       â† PC (acciones)
  audio          â† PC (volumen real)
  desiredAudio   â† mÃ³vil (volumen deseado)
  presence       â† PC (rol, equipo, lastSeen)
  commands/      â† mÃ³vil (Ã³rdenes; el PC las ejecuta y borra)
  trustedDevices/â† mÃ³vil
```

## Coste y lÃ­mites

Todo gratis: GitHub Pages (repo pÃºblico), Firebase Spark, Python de cÃ³digo abierto.
Sin tÃºnel, sin dominio y sin tarjeta. El PC debe estar encendido con el daemon corriendo.

## Problemas

- **El mÃ³vil no cambia:** pulsa Guardar en el editor y comprueba que el PC dice "en lÃ­nea".
- **No abre el editor:** el daemon no estÃ¡ corriendo o el puerto 8000 estÃ¡ ocupado.
- **ContraseÃ±a incorrecta en el PC:** cambia la contraseÃ±a desde el editor del PC
  (o actualiza `pc/config.json`).
- **Slider no mueve el volumen:** `pip install pycaw comtypes` y reinicia el daemon.

