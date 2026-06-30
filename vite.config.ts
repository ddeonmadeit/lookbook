import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
// Base path: "/" for custom hosts (Vercel/Netlify/etc.), "/lookbook/" for
// GitHub Pages project sites. Set via the VITE_BASE env var at build time.
const BASE = process.env.VITE_BASE || "/";

export default defineConfig(({ mode }) => ({
  base: BASE,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,gif,woff2}"],
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: "KNOTS",
        short_name: "KNOTS",
        description: "KNOTS Store",
        theme_color: "#0f0e0d",
        background_color: "#0f0e0d",
        display: "standalone",
        orientation: "portrait",
        start_url: BASE,
        icons: [
          {
            src: "/favicon.ico",
            sizes: "64x64",
            type: "image/x-icon",
          },
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
