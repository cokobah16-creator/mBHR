import { test, expect, type Page } from "@playwright/test";

// The staff login form lives at /login ("/" is the landing page), runs in
// offline PIN mode by default, and its field is `pattern="\d{6}"`, so only a
// six-digit PIN ever reaches the submit handler.
const PIN_FIELD = 'input[aria-label="PIN"]';
const CONFIRM_PIN_FIELD = 'input[aria-label="Confirm PIN"]';
const NAME_FIELD = 'input[aria-label="Full name"]';
const SEEDED_PIN = "482913";
// 16 bytes ("mbhr-smoke-test1"), matching SALT_LENGTH in src/utils/pin.ts.
// Fixed rather than random so the run is deterministic.
const PIN_SALT = "bWJoci1zbW9rZS10ZXN0MQ==";
const DB_NAME = "mbhr_v5";

// src/main.tsx opens Dexie, runs 16 schema versions and seeds reference data
// before it calls root.render, so `load` firing says nothing about whether the
// app is usable. Everything here waits on the app instead of on the page.
const BOOT_TIMEOUT = 30_000;

// Surface what the browser saw. Without this a boot failure reads only as
// "element not found", which is what made the previous run so hard to
// diagnose; the list reporter prints these inline in CI.
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[console.${msg.type()}] ${msg.text()}`);
    }
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "<no body>");
  console.log(`[failure] url=${page.url()}`);
  console.log(`[failure] body=${body.replace(/\s+/g, " ").slice(0, 600)}`);
});

// Navigates and waits for React to mount. main.tsx renders a "Startup error"
// screen instead of the app when the database will not open, so check for that
// explicitly rather than letting it surface as a missing selector.
async function bootApp(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page
    .locator("#root > *")
    .first()
    .waitFor({ state: "attached", timeout: BOOT_TIMEOUT });

  if (await page.getByText("Startup error").isVisible()) {
    const detail = await page.locator("#root").innerText();
    throw new Error(`the app failed to start: ${detail}`);
  }
}

// Writes a known staff user straight into the users store.
//
// This must run only once the app has mounted. Dexie is still stepping through
// its schema upgrades while the page is loading, and a second connection
// opened mid-upgrade blocks it, which hangs the boot before React ever
// renders. bootApp() is the guarantee that the upgrade is finished.
async function seedStaffUser(page: Page): Promise<void> {
  await page.evaluate(
    async ({ pin, salt, dbName }) => {
      const handle = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!handle.objectStoreNames.contains("users")) {
        handle.close();
        throw new Error(`${dbName} has no users store`);
      }

      // Mirrors derivePinHash() in src/utils/pin.ts: PBKDF2-SHA256, 100k
      // iterations, 32-byte hex digest. Changing it there requires the same
      // change here or the seeded PIN stops verifying.
      const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(pin),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 100_000, hash: "SHA-256" },
        keyMaterial,
        256,
      );
      const pinHash = Array.from(new Uint8Array(bits))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      await new Promise<void>((resolve, reject) => {
        const tx = handle.transaction("users", "readwrite");
        // isActive must be 1: the auth store filters on it before verifying,
        // and needsFirstRunSetup() counts only active users.
        tx.objectStore("users").put({
          id: "e2e-smoke-admin",
          fullName: "E2E Smoke Admin",
          role: "admin",
          email: "e2e-smoke@local",
          pinHash,
          pinSalt: salt,
          adminAccess: true,
          adminPermanent: false,
          isActive: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      handle.close();
    },
    { pin: SEEDED_PIN, salt: PIN_SALT, dbName: DB_NAME },
  );
}

// Boots the app on the public landing page, writes a staff user, then lands on
// the login form with a PIN that works. Going straight to /login on a device
// with no staff account would bounce to /setup instead.
async function openLoginWithSeededUser(page: Page): Promise<void> {
  await bootApp(page, "/");
  await seedStaffUser(page);
  await bootApp(page, "/login");
  await expect(page.locator(PIN_FIELD)).toBeVisible({ timeout: BOOT_TIMEOUT });
}

test.describe("First-run setup", () => {
  test("sends a device with no staff account to setup", async ({ page }) => {
    await bootApp(page, "/login");

    await expect(page).toHaveURL(/\/setup$/, { timeout: BOOT_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Set up this device" }),
    ).toBeVisible();
  });

  test("creates the first administrator and signs in", async ({ page }) => {
    const setupPin = "715204";
    await bootApp(page, "/setup");
    await expect(page.locator(NAME_FIELD)).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });

    await page.locator(NAME_FIELD).fill("E2E Setup Admin");
    await page.locator(PIN_FIELD).fill(setupPin);
    await page.locator(CONFIRM_PIN_FIELD).fill(setupPin);
    await page.getByRole("button", { name: "Create administrator" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: BOOT_TIMEOUT });
  });

  test("refuses to run once a staff account exists", async ({ page }) => {
    await bootApp(page, "/");
    await seedStaffUser(page);

    await bootApp(page, "/setup");

    await expect(page).toHaveURL(/\/login$/, { timeout: BOOT_TIMEOUT });
  });
});

test.describe("Staff login", () => {
  test("shows the login page", async ({ page }) => {
    await openLoginWithSeededUser(page);

    await expect(page.locator("h1")).toContainText("MedBridge Health Reach");
  });

  test("shows an error for an unknown PIN", async ({ page }) => {
    await openLoginWithSeededUser(page);

    await page.locator(PIN_FIELD).fill("000000");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText("Invalid PIN")).toBeVisible();
  });

  test("signs in with a valid PIN", async ({ page }) => {
    await openLoginWithSeededUser(page);

    await page.locator(PIN_FIELD).fill(SEEDED_PIN);
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: BOOT_TIMEOUT });
  });
});
