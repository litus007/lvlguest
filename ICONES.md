# Icones de LVCLITS Web Guest

## 1. Icones de la interfície (botons, pestanyes, trucada)

Ara són emojis. **No cal tocar codi per canviar-les**: deixa el fitxer a
`public/ui-icons/<nom>.svg` (o `.png`) i l'aplicació el fa servir sol; si el
fitxer no hi és, es veu l'emoji de sempre. Es poden anar substituint d'una en una.

- **Format:** SVG (preferit) o PNG transparent.
- **Mida:** SVG amb `viewBox="0 0 24 24"` · PNG **64×64** (es mostren a 16–20 px;
  les dues grans, a 44 px, convé que siguin **128×128**).
- **Color:** una `<img>` no hereta el color del text, així que dibuixa-les ja amb el color final.
  Els fons dels botons són foscos: usa gris clar (`#E5E7EB`) o el color de l'accent.

| Nom del fitxer | Substitueix | On surt | Mida |
|---|---|---|---|
| `tool-game` | 🎮 | pestanya Jugar | 16 |
| `tool-assist` | 🩺 | pestanya Assistència | 16 |
| `tool-call` | 📞 | pestanya Trucada | 16 |
| `sound-on` / `sound-off` | 🔊 / 🔇 | so del joc | 20 |
| `fullscreen-enter` / `fullscreen-exit` | 📺 / 🡼 | pantalla completa | 20 |
| `gamepad` | 🕹️ | mostra/amaga el mando virtual | 20 |
| `control-on` / `control-off` | 🎮 / 👁️ | prendre/deixar el control | 20 |
| `mic-on` / `mic-off` | 🎤 / 🔇 | micròfon (barra) | 20 |
| `mic-on` / `mic-off` | 🎤 / 🔇 | micròfon gran de la trucada | **128** |
| `hang-up` | 📵 | penjar la trucada | 18 |
| `disconnect` | ✖ | desconnectar | 20 |
| `chat` | 💬 | xat amb el Host | 20 |
| `send` | ➤ | enviar missatge | 16 |
| `send-file` | 📤 | enviar fitxer | 20 |
| `diagnostics` | 🩺 | estadístiques del Host | 20 |
| `quick-clean` | 🧹 | buidar temporals del Host | 16 |
| `quick-lock` | 🔒 | bloquejar el Host | 16 |
| `hud-hide` / `hud-show` | ⬍ / 👁️ | amagar/mostrar la barra | 20 |

> `mic-on` i `mic-off` es fan servir a dos llocs amb mides diferents: dibuixa'ls
> en SVG, o en PNG de 128×128 (es redueix bé).

## 2. Icones de l'aplicació web instal·lable (PWA)

Van a `public/icons/`. Fan servir de debò aquests:

| Fitxer | Mida | Notes |
|---|---|---|
| `192.png` | 192×192 | manifest + icona de la pestanya |
| `512.png` | 512×512 | manifest + icona de la pestanya |
| `apple-touch-icon.png` | 180×180 | iOS: **sense transparència** (fons ple) |
| `maskable-192.png` | 192×192 | Android: fons fins a les vores; el dibuix dins del 80 % central |
| `maskable-512.png` | 512×512 | igual que l'anterior |

Els altres (`16, 32, 48, 64, 128, 256, 1024`) no estan referenciats ara mateix;
són opcionals.
