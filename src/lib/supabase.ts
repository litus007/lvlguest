import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Falten les variables d'entorn VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. " +
      "Han de ser EXACTAMENT el mateix projecte de Supabase que utilitza l'app d'escriptori, " +
      "perquè Host i Guest s'han de trobar al mateix backend."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
