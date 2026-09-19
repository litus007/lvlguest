import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        lang: "ca",
        name: "LVCLITS · Joc Remot",
        short_name: "LVCLITS",
        description: "Juga en remot al sistema LVCLITS — rep la pantalla d'un altre jugador i controla-la amb teclat, ratolí o comandament.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#050505",
        theme_color: "#050505",
        icons: [
          { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache l'HTML/JS/CSS de l'app perquè la pantalla de codi de
        // sala carregui a l'instant i funcioni com una app instal·lada.
        // El vídeo en si mai passa per aquí — és sempre trànsit P2P en
        // directe, no un recurs cachejable.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
      },
    }),
  ],
});
