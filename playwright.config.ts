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

  webServer: useDeployed
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
      },
});
