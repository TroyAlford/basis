import { expect, test } from '@playwright/test'

test.describe('Dialog keyboard (real browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/components/dialog')
  })

  test('Enter confirms Dialog.editor when name TextEditor is focused', async ({ page }) => {
    await page.getByRole('button', { name: 'Dialog.editor (editor dialog)' }).click()
    const dialog = page.locator('dialog.dialog.component[open]')
    await expect(dialog).toBeVisible()

    const nameInput = dialog.locator('[data-field="name"] .value')
    await nameInput.click()
    await nameInput.fill('Playwright Article')
    await page.keyboard.press('Enter')

    await expect(dialog).not.toBeVisible()
    await expect(page.getByText(/submitted:.*Playwright Article/)).toBeVisible()
  })

  test('Escape dismisses Dialog.editor when name field is auto-focused', async ({ page }) => {
    await page.getByRole('button', { name: 'Dialog.editor (editor dialog)' }).click()
    const dialog = page.locator('dialog.dialog.component[open]')
    await expect(dialog).toBeVisible()

    const nameInput = dialog.locator('[data-field="name"] .value')
    await expect(nameInput).toBeFocused()
    await nameInput.fill('should not submit')
    await page.keyboard.press('Escape')

    await expect(dialog).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByText('cancelled', { exact: true })).toBeVisible()
  })

  test('Escape dismisses Dialog.editor when name TextEditor is focused', async ({ page }) => {
    await page.getByRole('button', { name: 'Dialog.editor (editor dialog)' }).click()
    const dialog = page.locator('dialog.dialog.component[open]')
    await expect(dialog).toBeVisible()

    const nameInput = dialog.locator('[data-field="name"] .value')
    await nameInput.click()
    await nameInput.fill('should not submit')
    await page.keyboard.press('Escape')

    await expect(dialog).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByText('cancelled', { exact: true })).toBeVisible()
  })

  test('Escape dismisses Dialog.confirm', async ({ page }) => {
    await page.getByRole('button', { name: 'Dialog.confirm (primary)' }).click()
    const dialog = page.locator('dialog.dialog.component[open]')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByText('cancelled', { exact: true })).toBeVisible()
  })
})
