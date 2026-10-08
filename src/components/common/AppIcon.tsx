import { useEffect, useState } from "react";

/**
 * 🖼️ Icona de la interfície amb RESERVA a emoji.
 *
 * Si existeix `public/ui-icons/<name>.svg` (o `.png`), es fa servir aquest
 * fitxer; si no, es mostra l'emoji de sempre. Així es poden anar substituint
 * les icones d'una en una només deixant el fitxer amb el nom correcte — sense
 * tocar codi. (Llista de noms i mides a `ICONES.md`.)
 */
const cache = new Map<string, string | null>(); // nom -> URL trobada, o null si no n'hi ha

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function resolveIcon(name: string): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null;
  for (const ext of ["svg", "png"]) {
    const url = `/ui-icons/${name}.${ext}`;
    if (await probe(url)) {
      cache.set(name, url);
      return url;
    }
  }
  cache.set(name, null);
  return null;
}

export default function AppIcon({
  name,
  fallback,
  size = 20,
}: {
  name: string;
  fallback: React.ReactNode;
  size?: number;
}) {
  const [url, setUrl] = useState<string | null>(cache.get(name) ?? null);

  useEffect(() => {
    let alive = true;
    resolveIcon(name).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  if (!url) return <>{fallback}</>;
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className="pointer-events-none select-none"
      style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle" }}
    />
  );
}
