/**
 * Compatibilitat de cada eina per dispositiu. Font única: es mostra a la web
 * i a l'app d'escriptori (components/common/CompatBadges.tsx).
 *
 *  yes     = funciona sencera
 *  partial = funciona amb límits (la nota diu quins)
 *  no      = no disponible
 *
 * Criteri: suport de les APIs del navegador a cada sistema. L'app d'escriptori és
 * només per a Windows; el que s'hi connecta des d'un navegador (la part "guest")
 * sí que funciona des de qualsevol dispositiu. Revisa-ho amb els teus aparells
 * reals i ajusta aquesta taula si cal.
 */

export type Platform = "win" | "mac" | "android" | "ios";
export type Support = "yes" | "partial" | "no";
export type CompatTool = "lan" | "stream" | "assist" | "call" | "callweb" | "transfer" | "screen" | "board";

export const PLATFORMS: { id: Platform; emoji: string; name: string }[] = [
  { id: "win", emoji: "🖥️", name: "Windows" },
  { id: "mac", emoji: "🍎", name: "Mac" },
  { id: "android", emoji: "🤖", name: "Android" },
  { id: "ios", emoji: "📱", name: "iPhone / iPad" },
];

export const SUPPORT_GLYPH: Record<Support, string> = { yes: "✅", partial: "⚠️", no: "❌" };
export const SUPPORT_LABEL: Record<Support, string> = { yes: "Funciona", partial: "Amb límits", no: "No disponible" };

const GUEST_ONLY = "Només com a convidat des del navegador; l'amfitrió ha de ser un Windows amb l'app.";

type Entry = { support: Record<Platform, Support>; notes: Partial<Record<Platform, string>> };

export const COMPAT: Record<CompatTool, Entry> = {
  lan: {
    support: { win: "yes", mac: "no", android: "no", ios: "no" },
    notes: { mac: "L'adaptador de xarxa virtual només existeix a Windows.", android: "Només Windows.", ios: "Només Windows." },
  },
  stream: {
    support: { win: "yes", mac: "partial", android: "partial", ios: "partial" },
    notes: { mac: GUEST_ONLY, android: GUEST_ONLY + " Amb comandament Bluetooth o tàctil.", ios: GUEST_ONLY },
  },
  assist: {
    support: { win: "yes", mac: "partial", android: "partial", ios: "partial" },
    notes: {
      mac: "Pots fer de tècnic des del navegador; qui rep l'ajuda ha de tenir Windows amb l'app.",
      android: "Pots fer de tècnic des del navegador; qui rep l'ajuda ha de tenir Windows amb l'app.",
      ios: "Pots fer de tècnic des del navegador; qui rep l'ajuda ha de tenir Windows amb l'app.",
    },
  },
  call: {
    support: { win: "yes", mac: "partial", android: "partial", ios: "partial" },
    notes: { mac: GUEST_ONLY + " O fes servir «Entre navegadors».", android: GUEST_ONLY + " O fes servir «Entre navegadors».", ios: GUEST_ONLY + " O fes servir «Entre navegadors»." },
  },
  callweb: {
    support: { win: "yes", mac: "yes", android: "yes", ios: "yes" },
    notes: { ios: "Safari: cal tocar la pantalla per activar el so.", android: "El volum de la trucada s'ajusta amb els botons de volum del telèfon." },
  },
  transfer: {
    support: { win: "yes", mac: "yes", android: "partial", ios: "partial" },
    notes: {
      android: "No es pot desar directament a disc: el fitxer passa per la memòria. Millor per a fitxers petits o mitjans.",
      ios: "No es pot desar directament a disc: el fitxer passa per la memòria. Millor per a fitxers petits o mitjans.",
      mac: "Amb Safari o Firefox el fitxer passa per la memòria; amb Chrome o Edge es desa directament a disc.",
    },
  },
  screen: {
    support: { win: "yes", mac: "yes", android: "partial", ios: "partial" },
    notes: {
      android: "Només pots mirar; compartir pantalla no està disponible als mòbils.",
      ios: "Només pots mirar; compartir pantalla no està disponible als mòbils.",
      mac: "Per compartir cal donar permís de «Gravació de pantalla» al navegador (Preferències del sistema).",
    },
  },
  board: {
    support: { win: "yes", mac: "yes", android: "yes", ios: "yes" },
    notes: { android: "Es dibuixa amb el dit o amb llapis tàctil.", ios: "Es dibuixa amb el dit o amb l'Apple Pencil." },
  },
};
