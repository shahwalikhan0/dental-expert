import { Page, expect } from '@playwright/test'

/**
 * Open the first appointment's detail page from the appointments list.
 *
 * Rows in app/(dashboard)/appointments/page.tsx are ClickableRows (role="link",
 * not <a>), so clicking the first cell opens the appointment. A blind
 * `a[href*="/appointments/"]` would land on the creation form instead.
 */
export async function openFirstAppointmentDetail(page: Page) {
  await page.goto('/appointments')

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toBeVisible({ timeout: 10000 })

  // The row opens the record (ClickableRow); the menu no longer repeats it
  // with "View details". The first cell holds no control of its own.
  await firstRow.locator('td').first().click()

  // Detail route is /appointments/<cuid>; exclude /appointments/new.
  await page.waitForURL(/\/appointments\/(?!new)[^/]+$/, { timeout: 10000 })
}
