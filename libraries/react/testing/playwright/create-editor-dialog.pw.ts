import { expect, test } from '@playwright/test'

test.describe('CreateEditor-shaped Dialog.editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') event.preventDefault()
      }, true)
    })
  })

  test('Escape dismisses when auto-focused name field has text', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('open-create').click()

    const dialog = page.locator('dialog.dialog.component[open]')
    await expect(dialog).toBeVisible()

    const nameInput = dialog.locator('[data-field="name"] .value')
    await expect(nameInput).toBeFocused()
    await nameInput.fill('Article from fixture')
    await page.keyboard.press('Escape')

    await expect(dialog).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByTestId('result')).toHaveText('cancelled')
  })

  test('Enter confirms when auto-focused name field has text', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('open-create').click()

    const dialog = page.locator('dialog.dialog.component[open]')
    const nameInput = dialog.locator('[data-field="name"] .value')
    await expect(nameInput).toBeFocused()
    await nameInput.fill('Enter confirm')
    await page.keyboard.press('Enter')

    await expect(dialog).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByTestId('result')).toContainText('Enter confirm')
  })
})
