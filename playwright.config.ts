import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_BASE_URL lets CI run the smoke spec against a deployed preview
// (Vercel) instead of spinning up a local dev server. When the var is set,
// the webServer block is omitted.
// Port 4173 (vite preview's own default), deliberately not the dev server's
// 5173: reuseExistingServer matches on the URL alone, so sharing a port would
// let a running `npm run dev` stand in for the production build these specs
// need — and a dev server seeds demo staff, which is exactly the behaviour
// under test.
const PREVIEW_PORT = 4173;
const previewURL = `http://localhost:${PREVIEW_PORT}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? previewURL;
const useDeployed = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // The list reporter prints the spec's own console.log diagnostics inline, so
  // a CI failure is readable from the job log without downloading the report.
  reporter: process.env.CI ? [["list"], ["html"]] : "html",
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

  // Always serve the built bundle. Demo staff are seeded in development only,
  // so the dev server and a production build disagree about what a fresh
  // device looks like — and first-run setup is exactly what these specs cover.
  // CI downloads dist/ from the build job, so only local runs need to build.
  webServer: useDeployed
    ? undefined
    : {
        command: process.env.CI
          ? `npm run preview -- --port ${PREVIEW_PORT} --strictPort`
          : `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
        url: previewURL,
        reuseExistingServer: !process.env.CI,
        // A local run builds first; the default 60s is not enough for that.
        timeout: 180_000,
      },
});
