import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_BASE_URL lets CI run the smoke spec against a deployed preview
// (Vercel) instead of spinning up a local dev server. When the var is set,
// the webServer block is omitted.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const useDeployed = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // In CI the built app in dist/ is served, so the smoke spec exercises the
  // same production bundle the build job produced rather than the dev server.
  // Locally `npm run dev` keeps hot reload.
  webServer: useDeployed
    ? undefined
    : {
        command: process.env.CI
          ? "npm run preview -- --port 5173 --strictPort"
          : "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
      },
});
