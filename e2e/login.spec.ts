import { test, expect } from '@playwright/test'

test.describe('Login Flow', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toContainText('mBHR')
  })

  test('should show error for invalid PIN', async ({ page }) => {
    await page.goto('/')

    await page.fill('input[type="password"]', '0000')
    await page.click('button[type="submit"]')

    await expect(page.locator('text=Invalid PIN')).toBeVisible()
  })

  test('should login successfully with valid PIN', async ({ page }) => {
    await page.goto('/')

    await page.fill('input[type="password"]', '1111')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('text=Dashboard')).toBeVisible()
  })
})
