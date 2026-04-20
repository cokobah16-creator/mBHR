import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const define: Record<string, string> = {};

  if (!env.VITE_SUPABASE_URL && env.SUPABASE_URL) {
    define["import.meta.env.VITE_SUPABASE_URL"] = JSON.stringify(
      env.SUPABASE_URL,
    );
  }

  if (!env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY) {
    define["import.meta.env.VITE_SUPABASE_ANON_KEY"] = JSON.stringify(
      env.SUPABASE_ANON_KEY,
    );

  // Keep Vercel/Supabase integration compatibility: when only SUPABASE_*
  // vars are present, promote them to VITE_* so existing client code using
  // import.meta.env.VITE_SUPABASE_* continues to work without define overrides.
  if (!process.env.VITE_SUPABASE_URL && env.SUPABASE_URL) {
    process.env.VITE_SUPABASE_URL = env.SUPABASE_URL;
  }
  if (!process.env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY) {
    process.env.VITE_SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
  }

  return {
    ...(Object.keys(define).length ? { define } : {}),
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes("node_modules")) {
              if (
                id.includes("react") ||
                id.includes("react-dom") ||
                id.includes("react-router")
              ) {
                return "react-vendor";
              }
              if (
                id.includes("react-hook-form") ||
                id.includes("zod") ||
                id.includes("@hookform")
              ) {
                return "form-vendor";
              }
              if (id.includes("@headlessui") || id.includes("@heroicons")) {
                return "ui-vendor";
              }
              if (id.includes("dexie") || id.includes("idb-keyval")) {
                return "db-vendor";
              }
              if (id.includes("i18next")) {
                return "i18n-vendor";
              }
              if (id.includes("zustand")) {
                return "state-vendor";
              }
              if (id.includes("@supabase")) {
                return "supabase-vendor";
              }
              if (id.includes("@sentry")) {
                return "sentry-vendor";
              }
            }

            if (id.includes("/features/gamification/")) {
              return "gamification";
            }
            if (id.includes("/features/analytics/")) {
              return "analytics";
            }
            if (id.includes("/features/pharmacy/")) {
              return "pharmacy";
            }
            if (id.includes("/features/patient-portal/")) {
              return "patient-portal";
            }
            if (id.includes("/features/tickets/")) {
              return "tickets";
            }
            if (id.includes("/features/labs/")) {
              return "labs";
            }
            if (id.includes("/features/triage/")) {
              return "triage";
            }
            if (id.includes("/features/vitals/")) {
              return "vitals";
            }
            if (id.includes("/pages/admin/")) {
              return "admin";
            }
            if (id.includes("/i18n/locales/")) {
              const lang = id.match(/locales\/(\w+)\.json/)?.[1];
              if (lang) return lang;
            }
          },
        },
      },
      chunkSizeWarningLimit: 1000,
      target: "es2020",
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: mode === "production",
          drop_debugger: true,
          pure_funcs:
            mode === "production" ? ["console.log", "console.info"] : [],
        },
      },
    },
    esbuild: {
      drop: mode === "production" ? ["console", "debugger"] : [],
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,mp3}"],
          maximumFileSizeToCacheInBytes: 3000000,
        },
        manifest: {
          name: "Med Bridge Health Reach",
          short_name: "MBHR",
          description: "Offline-first medical outreach platform",
          theme_color: "#0A7A3B",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "pwa-512x512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
      }),
    ],
  };
});
