/**
 * Mensajes de input que el guest manda al host por el DataChannel.
 * Diseñados para ser lo más compactos posible — se envían a alta frecuencia
 * (hasta 60 veces por segundo para el estado del mando).
 */
export type InputMessage =
  | { t: "kd"; code: string }                    // keydown: código de tecla (ej: "KeyA", "Space")
  | { t: "ku"; code: string }                    // keyup
  | { t: "mm"; x: number; y: number; dx: number; dy: number } // mousemove: posición + delta
  | { t: "mb"; btn: 0 | 1 | 2; down: boolean }  // mousebutton: botón + estado
  | { t: "mw"; dy: number }                      // mousewheel: delta vertical
  | {                                             // gamepad: estado completo del mando
      t: "gp";
      lx: number; ly: number;   // stick izquierdo (-32768..32767)
      rx: number; ry: number;   // stick derecho
      lt: number; rt: number;   // gatillos (0..255)
      btns: number;             // bitmask de botones (compatible XInput)
    };