import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
// Base path: "/" for custom hosts (Vercel/Netlify/etc.), "/lookbook/" for
// GitHub Pages project sites. Set via the VITE_BASE env var at build time.
const BASE = process.env.VITE_BASE || "/";

/**
 * The unlisted /nye ticket page gets its own copy of index.html, at
 * nye/index.html. That makes the link a real page (a 200 rather than GitHub
 * Pages' 404 fallback), gives it its own preview when it's shared, and tells
 * search engines never to list it.
 */
function nyePage(): Plugin {
  const site = "https://knotsss.com";
  const title = "KNOTS — New Year's Eve";
  const description = "31.12.2026 · Sydney. 100 tickets only.";
  const image = `${site}/nye/og.png`;
  const meta = (attr: "name" | "property", key: string, value: string) =>
    (html: string) => {
      const tag = `<meta ${attr}="${key}" content="${value}">`;
      const re = new RegExp(`<meta ${attr}="${key}"[^>]*>`);
      return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `  ${tag}\n</head>`);
    };
  return {
    name: "nye-page",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") return;
      let html = String(index.source).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
      for (const edit of [
        meta("name", "robots", "noindex, nofollow"),
        meta("name", "description", description),
        meta("name", "theme-color", "#000000"),
        meta("property", "og:title", title),
        meta("property", "og:description", description),
        meta("property", "og:url", `${site}/nye`),
        meta("property", "og:image", image),
        meta("name", "twitter:title", title),
        meta("name", "twitter:description", description),
        meta("name", "twitter:image", image),
      ]) {
        html = edit(html);
      }
      html = html.replace(/\s*<meta name="twitter:site"[^>]*>/, "");
      this.emitFile({ type: "asset", fileName: "nye/index.html", source: html });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: BASE,
  build: {
    rollupOptions: {
      output: {
        // Big, rarely-changing libraries get their own long-cached chunks so
        // app updates don't force shoppers to re-download them.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    nyePage(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,gif,woff2}"],
        // The admin app's icons are only needed by the owner; don't make every shopper download them.
        // Nor the NYE page's link-preview image, which only chat apps fetch.
        globIgnores: ["**/admin-*.png", "**/nye/og.png"],
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
