import { beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { ApplicationHandle } from '../../../testing'
import { describe, test, useApplication } from '../../../testing'

const root = join(import.meta.dir, '..', '..', '..', '..')

const options = {
  cwd: root,
  entry: './testing/components/serve.ts',
  timeoutMs: 120_000,
}

describe('overlay real browser', () => {
  let app: ApplicationHandle

  beforeAll(async () => {
    app = await useApplication(options)
  }, 120_000)

  test('mounts native modal chrome that stays in the viewport while the page scrolls', async () => {
    await app.visit('/overlay', async page => {
      await page.locator('#open-basic').click()

      const dialog = page.locator('dialog.dialog.component')
      await dialog.waitFor()

      expect(await dialog.evaluate(element => (element as HTMLDialogElement).open)).toBe(true)
      expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true)

      const bounds = await dialog.evaluate(element => {
        window.scrollTo(0, 900)
        const rect = element.getBoundingClientRect()
        return { bottom: rect.bottom, top: rect.top, viewport: window.innerHeight }
      })

      expect(bounds.top).toBeGreaterThanOrEqual(0)
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport)

      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.querySelector('dialog'))

      const events = await page.evaluate(() => window.__overlayEvents ?? [])
      expect(events.filter(event => event === 'basic:dismissing')).toHaveLength(1)
      expect(events).toContain('basic:false')
    })
  }, 60_000)

  test('routes native backdrop clicks through the dismissal guard without dismissing inside clicks', async () => {
    await app.visit('/overlay', async page => {
      await page.click('#open-basic')
      await page.locator('dialog').waitFor()

      await page.mouse.click(4, 4)
      await page.waitForFunction(() => !document.querySelector('dialog'))

      const events = await page.evaluate(() => window.__overlayEvents ?? [])
      expect(events.filter(event => event === 'basic:dismissing')).toHaveLength(1)

      await page.click('#open-basic')
      await page.locator('dialog').waitFor()
      await page.click('#basic-content')

      expect(await page.locator('dialog').count()).toBe(1)

      await page.locator('dialog button:has-text("Cancel")').click()
      await page.waitForFunction(() => !document.querySelector('dialog'))
    })
  }, 60_000)

  test('stacks a nested confirmation without deadlock and restores focus through the stack', async () => {
    await app.visit('/overlay', async page => {
      await page.click('#open-nested')
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 1)

      const parent = page.locator('dialog').filter({ hasText: 'Parent dialog' })
      await parent.waitFor()
      await page.locator('#inner-focus').focus()
      await parent.locator('button:has-text("Close")').click()
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 2)

      expect(await page.locator('dialog').filter({ hasText: 'Discard changes?' }).count()).toBe(1)

      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 1)
      expect(await page.locator('dialog').filter({ hasText: 'Parent dialog' }).count()).toBe(1)

      await page.locator('dialog button:has-text("Close")').click()
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 2)
      await page.locator('dialog button:has-text("Discard")').click()
      await page.waitForFunction(() => !document.querySelector('dialog'))

      expect(await page.evaluate(() => document.activeElement?.id)).toBe('open-nested')

      const events = await page.evaluate(() => window.__overlayEvents ?? [])
      expect(events).toContain('nested:false')
      expect(events).toContain('nested:true')
      expect(events).toContain('parent:dismissed')
    })
  }, 60_000)

  test('guards a dirty editor, retains its draft, and updates shell chrome without remounting', async () => {
    await app.visit('/overlay', async page => {
      await page.click('#open-editor')
      await page.locator('dialog').waitFor()

      const input = page.locator('dialog input').first()
      await input.fill('Draft text')

      await page.evaluate(() => window.__overlayUpdateEditor?.())
      await page.waitForFunction(() => document.querySelector('dialog')?.textContent?.includes('Workspace draft'))

      expect(await input.inputValue()).toBe('Draft text')

      await input.focus()
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 2)
      await page.locator('dialog button:has-text("Keep editing")').click()
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 1)

      expect(await input.inputValue()).toBe('Draft text')

      await input.focus()
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelectorAll('dialog').length === 2)
      await page.locator('dialog button:has-text("Discard")').click()
      await page.waitForFunction(() => !document.querySelector('dialog'))

      const events = await page.evaluate(() => window.__overlayEvents ?? [])
      expect(events).toContain('editor:false')
    })
  }, 60_000)

  test('blocks Escape and Close while a persistent action is in flight', async () => {
    await app.visit('/overlay', async page => {
      await page.click('#open-save')
      await page.locator('dialog').waitFor()

      await page.locator('dialog button:has-text("Save")').click()
      await page.keyboard.press('Escape')
      await page.locator('dialog button:has-text("Close")').click({ force: true })

      await page.waitForTimeout(50)
      expect(await page.locator('dialog').count()).toBe(1)

      await page.waitForFunction(() => window.__overlayEvents?.includes('save:end'))
      expect(await page.locator('dialog').count()).toBe(1)
      expect(await page.evaluate(() => window.__overlayEvents?.filter(event => event === 'save:start'))).toHaveLength(1)

      await page.locator('dialog button:has-text("Close")').click()
      await page.waitForFunction(() => !document.querySelector('dialog'))
    })
  }, 60_000)

  test('renders notifications independently without displacing a modal dialog', async () => {
    await app.visit('/overlay', async page => {
      await page.click('#open-basic')
      const dialog = page.locator('dialog')
      await dialog.waitFor()

      await page.evaluate(() => window.__overlayNotify?.())
      const note = page.locator('aside.notification.component')
      await note.waitFor()

      expect(await note.textContent()).toContain('Background note')
      expect(await dialog.count()).toBe(1)
      expect(await dialog.evaluate(element => (element as HTMLDialogElement).open)).toBe(true)
      expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true)

      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.querySelector('dialog'))
    })
  }, 60_000)
})
