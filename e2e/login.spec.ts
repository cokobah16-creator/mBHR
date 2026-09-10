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

// Demo staff are seeded in development only, so the bundle under test starts
// with no users: every test that needs a PIN writes a known user straight into
// the store. Each Playwright test gets a fresh browser context, so IndexedDB
// starts empty for each of them.
async function seedStaffUser(page: Page): Promise<void> {
  await page.evaluate(
    async ({ pin, salt, dbName }) => {
      // Wait for main.tsx to create the database rather than creating it here,
      // so the schema and version stay whatever Dexie decided.
      const deadline = Date.now() + 15_000;
      let handle: IDBDatabase | null = null;
      while (Date.now() < deadline) {
        const existing = await indexedDB.databases();
        if (existing.some((entry) => entry.name === dbName)) {
          handle = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (handle.objectStoreNames.contains("users")) break;
          handle.close();
          handle = null;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!handle) {
        throw new Error(`${dbName}.users was not created within 15s`);
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
        {
          name: "PBKDF2",
          salt: saltBytes,
          iterations: 100_000,
          hash: "SHA-256",
        },
        keyMaterial,
        256,
      );
      const pinHash = Array.from(new Uint8Array(bits))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      await new Promise<void>((resolve, reject) => {
        const tx = handle!.transaction("users", "readwrite");
        // isActive must be 1: the auth store filters on it before verifying.
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

// Loads the app on the public landing page so main.tsx opens the database,
// writes a staff user into it, then lands on the login form with a PIN that
// works. Going straight to /login would bounce to /setup instead.
async function openLoginWithSeededUser(page: Page): Promise<void> {
  await page.goto("/");
  await seedStaffUser(page);
  await page.goto("/login");
  await expect(page.locator(PIN_FIELD)).toBeVisible();
}

test.describe("First-run setup", () => {
  test("sends a device with no staff account to setup", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByRole("heading", { name: "Set up this device" }),
    ).toBeVisible();
  });

  test("creates the first administrator and signs in", async ({ page }) => {
    const setupPin = "715204";
    await page.goto("/setup");
    await expect(page.locator(NAME_FIELD)).toBeVisible();

    await page.locator(NAME_FIELD).fill("E2E Setup Admin");
    await page.locator(PIN_FIELD).fill(setupPin);
    await page.locator(CONFIRM_PIN_FIELD).fill(setupPin);
    await page
      .getByRole("button", { name: "Create administrator" })
      .click();

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("refuses to run once a staff account exists", async ({ page }) => {
    await page.goto("/");
    await seedStaffUser(page);

    await page.goto("/setup");

    await expect(page).toHaveURL(/\/login$/);
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

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
