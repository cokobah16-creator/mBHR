import { test, expect } from "@playwright/test";

async function login(page: ReturnType<(typeof test)["page"]>) {
  await page.goto("/");
  await page.fill('input[type="password"]', "1111");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("Patient Registration Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should navigate to registration page from dashboard", async ({
    page,
  }) => {
    await page.click("text=Register");
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator("h1")).toContainText("Patient Registration");
  });

  test("should show validation errors for empty required fields", async ({
    page,
  }) => {
    await page.goto("/register");
    await page.click('button[type="submit"]');

    await expect(page.locator("#givenName-error")).toBeVisible();
    await expect(page.locator("#familyName-error")).toBeVisible();
  });

  test("should fill and submit patient registration form", async ({ page }) => {
    await page.goto("/register");

    await page.fill("#givenName", "John");
    await page.fill("#familyName", "Doe");
    await page.selectOption("#sex", "male");
    await page.fill("#dob", "1990-05-15");
    await page.fill("#phone", "08012345678");
    await page.fill("#address", "123 Main Street, Lagos");
    await page.selectOption("#state", "Lagos");

    await page.waitForSelector('#lga option:not([value=""])');
    await page.selectOption("#lga", { index: 1 });

    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test("should show phone validation error for invalid format", async ({
    page,
  }) => {
    await page.goto("/register");

    await page.fill("#givenName", "Jane");
    await page.fill("#familyName", "Smith");
    await page.selectOption("#sex", "female");
    await page.fill("#dob", "1985-03-20");
    await page.fill("#phone", "123");
    await page.fill("#address", "456 Test Ave");
    await page.selectOption("#state", "Abuja");

    await page.waitForSelector('#lga option:not([value=""])');
    await page.selectOption("#lga", { index: 1 });

    await page.click('button[type="submit"]');

    await expect(page.locator("#phone-error")).toBeVisible();
  });

  test("should enable LGA dropdown after state selection", async ({ page }) => {
    await page.goto("/register");

    const lgaSelect = page.locator("#lga");
    await expect(lgaSelect).toBeDisabled();

    await page.selectOption("#state", "Lagos");

    await expect(lgaSelect).toBeEnabled();
    const options = await lgaSelect.locator("option").count();
    expect(options).toBeGreaterThan(1);
  });

  test("should allow registration with email instead of phone", async ({
    page,
  }) => {
    await page.goto("/register");

    await page.fill("#givenName", "Email");
    await page.fill("#familyName", "User");
    await page.selectOption("#sex", "other");
    await page.fill("#dob", "2000-01-01");
    await page.fill("#email", "test@example.com");
    await page.fill("#address", "789 Email Street");
    await page.selectOption("#state", "Kano");

    await page.waitForSelector('#lga option:not([value=""])');
    await page.selectOption("#lga", { index: 1 });

    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test("should navigate back to dashboard when cancel is clicked", async ({
    page,
  }) => {
    await page.goto("/register");

    await page.fill("#givenName", "Test");

    await page.click("text=Cancel");

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
