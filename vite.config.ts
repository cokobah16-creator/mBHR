import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";

export default defineConfig(({ command, mode }) => {
  // loadEnv reads .env / .env.[mode] files; the empty prefix loads all vars.
  const env = loadEnv(mode, process.cwd(), "");
  // `command` is "build" for every vite build invocation regardless of --mode,
  // so staging/preview builds correctly strip console output and debugger calls.
  const isBuild = command === "build";

  // Map bare Supabase env vars (Vercel integration) → VITE_ names so the
  // Supabase client can find them at runtime. We only inject a define entry
  // when the VITE_-prefixed name is NOT already present in the loaded env –
  // if it is, Vite exposes it to the client natively and adding a define
  // would override it with an empty string on any machine where the loaded env
  // object lacks the bare name.
  const defines: Record<string, string> = {};
  if (!env.VITE_SUPABASE_URL && env.SUPABASE_URL) {
    defines["import.meta.env.VITE_SUPABASE_URL"] = JSON.stringify(
      env.SUPABASE_URL,
    );
  }
  if (!env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY) {
    defines["import.meta.env.VITE_SUPABASE_ANON_KEY"] = JSON.stringify(
      env.SUPABASE_ANON_KEY,
    );
  }

  return {
    define: defines,
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
          drop_console: false,
          drop_debugger: true,
          pure_funcs: isBuild
            ? ["console.log", "console.info", "console.debug"]
            : [],
        },
      },
    },
    esbuild: {
      drop: isBuild ? ["debugger"] : [],
      pure: isBuild ? ["console.log", "console.info", "console.debug"] : [],
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,mp3}"],
          maximumFileSizeToCacheInBytes: 3000000,
          // Runtime caching tuned per host. See docs/CACHING_STRATEGY.md.
          runtimeCaching: [
            {
              // Supabase REST (PostgREST). Network-first with a short timeout
              // so stale data is served if the network is slow, but fresh data
              // beats cached when both are available.
              urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "supabase-rest",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Supabase Storage. Patient photos and exports — these are large
              // and rarely change after upload, so stale-while-revalidate keeps
              // the UI fast while updating in the background.
              urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "supabase-storage",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Google Fonts and similar static CDNs.
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "jsdelivr",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
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
