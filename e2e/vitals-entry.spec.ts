import { test, expect } from '@playwright/test'

async function login(page: ReturnType<typeof test['page']>) {
  await page.goto('/')
  await page.fill('input[type="password"]', '1111')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/dashboard/)
}

async function registerPatient(page: ReturnType<typeof test['page']>, name: string) {
  await page.goto('/register')
  await page.fill('#givenName', name)
  await page.fill('#familyName', 'VitalsTest')
  await page.selectOption('#sex', 'male')
  await page.fill('#dob', '1985-06-15')
  await page.fill('#phone', '08098765432')
  await page.fill('#address', '100 Vitals Test Street')
  await page.selectOption('#state', 'Lagos')
  await page.waitForSelector('#lga option:not([value=""])')
  await page.selectOption('#lga', { index: 1 })
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
}

test.describe('Vitals Entry Flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('should navigate to vitals page and show patient search', async ({ page }) => {
    await page.goto('/vitals')

    await expect(page.locator('h1')).toContainText('Record Vital Signs')
    await expect(page.locator('text=Select Patient')).toBeVisible()
  })

  test('should search for and select patient', async ({ page }) => {
    const testName = `VitalsE2E${Date.now()}`
    await registerPatient(page, testName)

    await page.goto('/vitals')
    await page.fill('input[placeholder*="Search patients"]', testName)

    await expect(page.locator(`text=${testName}`).first()).toBeVisible({ timeout: 5000 })

    await page.click(`text=${testName} VitalsTest`)

    await expect(page.locator('text=Record Vital Signs')).toBeVisible()
    await expect(page.locator(`text=${testName} VitalsTest`)).toBeVisible()
  })

  test('should display vitals form after patient selection', async ({ page }) => {
    const testName = `VitalsForm${Date.now()}`
    await registerPatient(page, testName)

    await page.goto('/vitals')
    await page.fill('input[placeholder*="Search patients"]', testName)
    await page.click(`text=${testName} VitalsTest`)

    await expect(page.locator('#vitals-heightCm')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#vitals-weightKg')).toBeVisible()
    await expect(page.locator('#vitals-tempC')).toBeVisible()
    await expect(page.locator('#vitals-pulseBpm')).toBeVisible()
  })

  test('should calculate BMI when height and weight are entered', async ({ page }) => {
    const testName = `BMITest${Date.now()}`
    await registerPatient(page, testName)

    await page.goto('/vitals')
    await page.fill('input[placeholder*="Search patients"]', testName)
    await page.click(`text=${testName} VitalsTest`)

    await page.waitForSelector('#vitals-heightCm', { timeout: 10000 })

    await page.fill('#vitals-heightCm', '170')
    await page.fill('#vitals-weightKg', '70')

    await expect(page.locator('text=BMI:')).toBeVisible({ timeout: 5000 })
  })

  test('should show warning for abnormal vitals', async ({ page }) => {
    const testName = `AbnormalVitals${Date.now()}`
    await registerPatient(page, testName)

    await page.goto('/vitals')
    await page.fill('input[placeholder*="Search patients"]', testName)
    await page.click(`text=${testName} VitalsTest`)

    await page.waitForSelector('#vitals-tempC', { timeout: 10000 })

    await page.fill('#vitals-tempC', '40')

    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 5000 })
  })

  test('should submit vitals form and navigate to consult', async ({ page }) => {
    const testName = `SubmitVitals${Date.now()}`
    await registerPatient(page, testName)

    await page.goto('/vitals')
    await page.fill('input[placeholder*="Search patients"]', testName)
    await page.click(`text=${testName} VitalsTest`)

    await page.waitForSelector('#vitals-heightCm', { timeout: 10000 })

    await page.fill('#vitals-heightCm', '175')
    await page.fill('#vitals-weightKg', '75')
    await page.fill('#vitals-tempC', '36.5')
    await page.fill('#vitals-pulseBpm', '72')
    await page.fill('#vitals-systolic', '120')
    await page.fill('#vitals-diastolic', '80')
    await page.fill('#vitals-spo2', '98')

    await page.click('text=Save Vitals')

    await expect(page).toHaveURL(/\/consult/, { timeout: 10000 })
  })

  test('should cancel vitals entry and return to queue', async ({ page }) => {
    const testName = `CancelVitals${Date.now()}`
    await registerPatient(page, testName)

    await page.goto('/vitals')
    await page.fill('input[placeholder*="Search patients"]', testName)
    await page.click(`text=${testName} VitalsTest`)

    await page.waitForSelector('#vitals-heightCm', { timeout: 10000 })

    await page.fill('#vitals-heightCm', '160')

    await page.click('text=Cancel')

    await expect(page).toHaveURL(/\/queue/)
  })
})
