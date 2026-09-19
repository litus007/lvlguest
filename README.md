# LVCLITS — Joc Remot Web (Guest)

Pàgina web independent (sense Tauri, sense instal·lació d'escriptori)
que fa de client remot: algú introdueix el codi de sala, rep la
pantalla que un Host de l'app **LVCLITS** està compartint, i la
**controla** amb teclat, ratolí o comandament — amb opció de pantalla
completa. Comparteix la mateixa identitat visual (logotip, colors,
marcs de cantonades) que l'app d'escriptori.

**Instal·lable com a app (PWA):** aquesta pàgina és una Progressive
Web App — es pot "instal·lar" des del navegador (icona pròpia,
pantalla completa sense barra d'adreces, funciona com una app nativa
lleugera) sense passar per cap botiga d'aplicacions.
- **Escriptori (Chrome/Edge):** apareix una icona ⊕ o "Instal·lar" a
  la barra d'adreces, o el botó "⬇ Instal·lar app" que mostra la
  mateixa pàgina quan el navegador ho permet.
- **Android (Chrome):** menú ⋮ → "Instal·la l'aplicació" / "Afegeix a
  la pantalla d'inici", o el mateix botó dins la pàgina.
- **iOS (Safari):** Safari no dispara la instal·lació automàtica —
  cal Compartir → "Afegeix a la pantalla d'inici" manualment.

**Control:** un cop connectat, la pàgina captura el teclat, el moviment
i botons del ratolí, la roda, i qualsevol comandament connectat (via la
Gamepad API del navegador — apareix un indicador "🎮 Comandament actiu"
a la capçalera quan en detecta un), i ho envia al Host pel mateix canal
de dades "inputs" que ja fa servir l'app d'escriptori. Qui vulgui
**compartir** la seva pròpia pantalla (rol Host) sempre necessitarà
l'app d'escriptori, perquè capturar pantalla i injectar inputs al
sistema operatiu no es pot fer des d'una pàgina web — però per
**jugar-hi en remot**, aquesta pàgina n'hi ha prou.

## Per què és possible

El costat "Guest" de l'app d'escriptori ja és WebRTC 100% estàndard de
navegador (`RTCPeerConnection`, `RTCDataChannel`, WebCodecs, Gamepad
API, esdeveniments de teclat/ratolí) — mai crida cap funció nativa de
Tauri. Aquest projecte reprodueix exactament el mateix protocol de
senyalització (Supabase Realtime: presència + broadcast
d'ofertes/respostes/ICE), el mateix mecanisme de recepció de vídeo
(frames H.264 crus per un `RTCDataChannel`, decodificats amb la
WebCodecs API sobre un `<canvas>`) i el mateix format de missatges
d'input pel canal "inputs", així que és compatible amb qualsevol Host
ja desplegat, sense tocar-hi res.

## Desenvolupament local

```bash
npm install
cp .env.example .env.local   # omple les dues variables (veure més avall)
npm run dev
```

## Variables d'entorn

`VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY` han de ser **exactament
les mateixes** que fa servir l'app d'escriptori (el mateix projecte de
Supabase), perquè Host i Guest s'han de trobar pel mateix backend de
senyalització. Les trobaràs a l'`.env` de l'app d'escriptori (`lan_virtual/.env`,
no versionat) o al tauler de Supabase → Project Settings → API.

## Desplegar a Vercel

1. Puja aquesta carpeta a un repositori de GitHub (pot ser un repo nou,
   o bé aquesta mateixa carpeta dins el repo `lan_virtual` — en aquest
   segon cas, a Vercel configura **Root Directory = `web-guest`**).
2. A Vercel: *New Project* → importa el repositori → framework detectat
   automàticament com **Vite**.
3. A *Environment Variables*, afegeix `VITE_SUPABASE_URL` i
   `VITE_SUPABASE_ANON_KEY` amb els mateixos valors que el `.env` de
   l'app d'escriptori.
4. Deploy. Cap configuració addicional (és una SPA estàtica d'una sola
   pàgina, sense rutes).

**Nota sobre la instal·labilitat:** el navegador només ofereix
instal·lar la pàgina quan es serveix per **HTTPS** (Vercel ho fa
automàticament) — en local (`npm run dev`) el botó "Instal·lar app" pot
no aparèixer encara que tot estigui ben configurat, això és normal.

## Limitacions conegudes

- Necessita un navegador amb **WebCodecs** (`VideoDecoder`) — Chrome,
  Edge o altres basats en Chromium recents. Safari i Firefox encara no
  ho suporten de manera estable (i a iOS/Safari tampoc es podrà
  instal·lar automàticament, només via "Afegeix a la pantalla d'inici").
- El codi de sala no es verifica contra cap base de dades: és
  literalment el nom del canal de senyalització de Supabase. Si el Host
  encara no ha creat la sala amb aquest codi, el visor es queda
  "Cercant..." fins que el Host apareix o fins que tanquis la pestanya.
- El trànsit de vídeo és sempre P2P (o via TURN si cal) directament
  entre Host i Guest — Vercel només serveix aquesta pàgina (i, un cop
  instal·lada, el seu "embolcall" d'app), mai el vídeo en si.
- Un cop connectat, la pàgina **intercepta tot el teclat i el ratolí**
  de la finestra/pestanya (necessari perquè el joc del Host respongui).
  Mentre estiguis jugant, dreceres del navegador com Alt+Tab entre
  pestanyes poden comportar-se diferent — usa el botó "Desconnectar" o
  tanca la pestanya per recuperar el control normal del navegador.
- La precisió del ratolí es basa en la posició del cursor dins la
  finestra, igual que a l'app d'escriptori — en pantalles amb una
  relació d'aspecte molt diferent a la del Host, el mapeig pot no ser
  1:1 exacte.
