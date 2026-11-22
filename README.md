# 🎛️ Stream Deck LOCAL (rápido, sin login)

El móvil habla **directamente con el portátil por WiFi**. No hay Firebase, no hay
login y no pasa nada por una base de datos. Latencia real medida: **~3 ms**.

## Arrancar

Doble clic en **`pc/Iniciar Stream Deck.bat`**.

Se abre un servidor en el PC. En la misma ventana verás:

```
Móvil (misma WiFi): http://192.168.x.x:8000
Panel del PC:       http://localhost:8000/admin
Código: 123456
```

## Emparejar el móvil (una sola vez)

1. Abre en el móvil la IP que te sale: `http://192.168.x.x:8000`.
2. Pon el **código de 6 dígitos** que aparece en `/admin` (o en la ventana).
3. Listo: el token se guarda en el móvil y no vuelve a pedir login.

## Usar

- Rejilla **7×3** en horizontal, botones metálicos, deslizadores verticales.
- **✏️** edita páginas, colores, imágenes, tamaños 1/2/4, posición y funciones.
- **⚙️** permite olvidar el dispositivo.
- Los cambios viajan por **Server-Sent Events**, así que el móvil se actualiza al instante.

## Funciones

En **✏️ → Funciones** eliges el botón por su nombre y pones qué hace:

| Tipo | Valor |
|---|---|
| `url` | `https://www.youtube.com` |
| `app` | ruta del `.exe` o `spotify:` |
| `cmd` | comando de Windows |
| `media` | `next`, `prev`, `playpause`, `mute` |
| `key` | `ctrl+shift+p` |
| `volume_master` / `volume_app` | nivel (o proceso) |

El daemon lee las funciones de `pc/local_state.json` (archivo ignorado por Git).

## Requisitos

- Mismo WiFi en móvil y portátil.
- Python + `pip install -r pc/requirements.txt`.
- El PC debe estar encendido con el servidor corriendo.

## Notas

- Usa la **IP del PC** en el móvil (no `localhost`, que en el móvil sería el propio móvil).
- `http://localhost:8000/admin` muestra el código y los dispositivos emparejados.
- El puerto 8000 solo se usa en tu red local.
