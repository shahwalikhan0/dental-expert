import { Page, expect } from '@playwright/test'

/**
 * Open the first patient's detail page from the patients list.
 *
 * Rows in app/(dashboard)/patients/page.tsx are ClickableRows (role="link",
 * not <a>). The only <a href*="/patients/"> on that page is the "New patient"
 * button (/patients/new), so `locator('a[href*="/patients/"]').first()` would
 * land on the creation form instead of a patient.
 */
export async function openFirstPatientDetail(page: Page) {
  await page.goto('/patients')

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toBeVisible({ timeout: 10000 })

  // The row opens the record (ClickableRow); the menu no longer repeats it
  // with "View details". The first cell holds no control of its own.
  await firstRow.locator('td').first().click()

  // Detail route is /patients/<cuid>; exclude /patients/new.
  await page.waitForURL(/\/patients\/(?!new)[^/]+$/, { timeout: 10000 })
}
