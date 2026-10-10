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

## Requisit: sempre un Host d'escriptori

Aquesta web és **només el costat Guest**. Les tres primeres eines (Jugar, Assistència, Trucada) necessiten que
l'altra banda tingui l'app d'escriptori LVCLITS oberta com a **Host**
(és qui captura pantalla/àudio/micròfon amb codi natiu, crea l'oferta
WebRTC i obre les sales). **Aquestes tres no funcionen entre dues webs.** L'excepció és 📁 **Transfer** (veure més avall), que no té Host. La
pàgina ho recorda amb un avís flotant (es pot tancar i es reobre amb el
botó ℹ️ de la capçalera).

## Multijugador (varis Guests a la mateixa sala)

El Host pot tenir **varis Guests alhora amb el mateix codi**:

- 🎮 **Jugar**: fins a **4 jugadors**. El Host crea un comandament virtual
  Xbox360 per jugador. El jugador 1 controla teclat, ratolí i mando; els
  altres, només el seu mando. El vídeo i el so es capturen i codifiquen un
  sol cop i es difonen a tothom.
- 📞 **Trucada**: fins a **8 persones**. Cada Guest només té connexió amb el
  Host, que retransmet la veu de cadascú a la resta (canals `voice:<peer_id>`,
  un reproductor per parlant). La senyalització va adreçada amb `toPeerId`.
- 🩺 **Assistència** continua sent d'**un sol Guest** (és una sessió
  tècnica 1 a 1).

## Mando virtual

No surt sol: s'activa amb el botó 🕹️ de la barra (en qualsevol dispositiu).
Porta stick esquerre (o creueta ✚), A/B/X/Y (o stick dret 🎯 per a la càmera),
LB/RB, LT/RT i Back/Start, i vibra en prémer si el dispositiu ho permet.

## Icones personalitzades

Vegeu `ICONES.md`: deixant fitxers a `public/ui-icons/<nom>.svg` es substitueixen els emojis sense tocar codi.

## Eines disponibles

Un selector a la pantalla d'inici tria l'eina; cada una fa servir el seu
propi espai de noms de senyalització, així que mai col·lideixen encara
que comparteixin codi:

| Eina | Sala de senyalització | Presència |
|------|----------------------|-----------|
| 🎮 Jugar | `<codi>` | `streaming-presence:<codi>` |
| 🩺 Assistència | `assist:<codi>` | `assist-presence:<codi>` |
| 📞 Trucada | `call:<codi>` | `call-presence:<codi>` |
| 📁 Transfer | `transfer:<paraula>` | al mateix canal |

**📞 Trucada Directa** és la més lleugera: només veu (canal de dades
`mic`, Opus amb capçalera de seqüència de 4 bytes). Aquesta pàgina només
pot **unir-se** a una trucada oberta des de l'app d'escriptori; per
obrir-ne una cal l'app. Sentir l'altra banda és automàtic; el botó del
micròfon només controla l'enviament. Cal Chrome o Edge per enviar veu
(`MediaStreamTrackProcessor` + `AudioEncoder`).

## 🌐 Eines web ↔ web (sense Host ni app d'escriptori)

Tres eines funcionen directament entre navegadors, amb el mateix sistema de **paraula** (canal Supabase amb
presència + broadcast, sense taules; mateixa URL i anon key) i P2P WebRTC:

| Eina | Què fa | Persones |
|---|---|---|
| 📁 **Transfer** | Arxius sense límit de mida **i missatges de text/enllaços** per la mateixa connexió | 2 |
| 🖥️ **Pantalla** | Una persona comparteix la pantalla (amb àudio de la pestanya si el navegador el dona); la resta mira. Optimitzable per a text/presentacions o vídeo/jocs | 1 + 4 |
| 📞 **Trucada** (per defecte) | Veu i càmera opcional en malla WebRTC, sense Host: panell estil Discord amb nivells de veu, volum per persona, dispositius, diagnòstic i moderació | fins a 6 |
| 🎨 **Pissarra** | Dibuix col·laboratiu en temps real: llapis, línia, fletxa, rectangle, el·lipse, text, goma, desfer, fons clar/fosc i descàrrega PNG. Els traços van P2P (data channels en malla), no per Supabase | fins a 6 |

Només es pot compartir pantalla des d'un navegador d'escriptori; als mòbils només es pot mirar. Codi:
`src/lib/screenShare.ts`, `src/lib/roomVoice.ts`, `src/lib/transferLink.ts` i els panells de `src/components/web/` i `src/components/transfer/`.

## 📁 Transfer — intercanvi d'arxius sense límits (eina 5)

Eina d'**intercanvi d'arxius sense límits**: P2P directe (WebRTC), res no es
puja a cap servidor. Fa servir el **mateix sistema de paraula** que la resta:
les dues persones escriuen la mateixa paraula i es troben. Va per Supabase
Realtime (presència + broadcast) amb la **mateixa URL i anon key**, **sense cap
taula ni SQL**.

- **Sense Host/Guest**: tots dos poden enviar i rebre. Funciona web↔web,
  web↔escriptori i escriptori↔escriptori (l'app d'escriptori inclou la mateixa eina).
- **Sala de 2 persones**: les dues primeres per hora d'entrada són la parella; una
  tercera veu "sala plena". Si una marxa, la sala segueix oberta per a una altra.
- **Sense límit de mida**: amb Chrome/Edge (File System Access API) el que es rep
  s'escriu directament a disc; l'emissor llegeix en blocs i el receptor confirma
  cada 4 MB (màx. 32 MB en vol), així que la RAM no creix. A Firefox/Safari/mòbil
  es fa fallback a memòria i el límit real és la RAM del receptor.
- **El receptor accepta cada fitxer** amb un clic (el navegador només deixa obrir
  "Desar com…" des d'un gest d'usuari), o tria una carpeta una vegada i la resta
  es desa sola. Es poden enviar varis fitxers a la vegada (en cua) i arrossegar-los.
- Codi: `src/lib/transferLink.ts` (nucli, idèntic a l'app d'escriptori),
  `src/hooks/useTransfer.ts`, `src/components/transfer/TransferPanel.tsx`.

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

## 📱 Compatibilitat per dispositiu

Cada eina mostra emojis amb el seu estat: 🖥️ Windows · 🍎 Mac · 🤖 Android · 📱 iPhone/iPad, amb ✅ funciona,
⚠️ amb límits (i una nota que ho explica) o ❌ no disponible. Font única: `src/lib/compat.ts`.

| Eina | 🖥️ | 🍎 | 🤖 | 📱 | Límit principal |
|---|---|---|---|---|---|
| Jugar / Assistència / Trucada (amb app) | ✅ | ⚠️ | ⚠️ | ⚠️ | Només com a convidat; l'amfitrió ha de ser Windows amb l'app |
| Trucada entre navegadors | ✅ | ✅ | ✅ | ✅ | Safari demana tocar la pantalla per activar el so |
| Transfer | ✅ | ✅ | ⚠️ | ⚠️ | Sense desat directe a disc: passa per la memòria |
| Pantalla | ✅ | ✅ | ⚠️ | ⚠️ | Als mòbils només es pot mirar (no compartir) |
| Pissarra | ✅ | ✅ | ✅ | ✅ | — |

Aquesta taula es basa en el suport de les APIs de cada navegador; revisa-la amb els teus dispositius reals.

## 📞 Trucada unificada (veu + càmera, web i app)

Un sol motor (`src/lib/roomVoice.ts`) per a navegadors i app d'escriptori; es poden barrejar a la mateixa paraula.
- **Referències visuals:** nivell del teu micro, anell verd quan algú parla, i per a cada persona «rebent» / «sense senyal»
  (bytes d'àudio que arriben de debò), latència i pèrdua de paquets. Si el micro no sent res, ho diu.
- **Panell d'ajustos:** micròfon i sortida (on el navegador ho permet), volum del micro fins al 300 %, volum de sortida fins al 200 %,
  volum i silenci per persona, reducció de soroll / eco / guany automàtic, i «escolta't» per provar.
- **Càmera** opcional, activable en qualsevol moment.
- **Amfitrió 👑:** l'app d'escriptori (si n'hi ha) o, si no, qui hi és des de fa més. Pot silenciar tothom, silenciar una persona
  (no es pot activar fins que ell la deixi) i expulsar. És cooperatiu: no hi ha servidor que ho imposi.
- La trucada «Clàssica (amb app)» es manté de moment com a opció secundària.
