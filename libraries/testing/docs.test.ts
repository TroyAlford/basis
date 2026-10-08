import { beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { ApplicationHandle } from './application'
import { useApplication } from './application'
import { matchScreenshot } from './matchScreenshot'
import { describe, test } from './test'

const root = join(import.meta.dir, '..', '..')

/*
 * The docs `Code` component loads Shiki from esm.sh and the Mermaid component
 * loads its runtime from esm.sh; the network policy blocks both by default, so
 * the visits allow that host and the pages render their real output.
 */
const NETWORK = { allow: ['esm.sh'] }

describe('testing/docs', () => {
  let app: ApplicationHandle

  beforeAll(async () => {
    app = await useApplication({
      cwd: root,
      entry: './testing/docs/index.ts',
      timeoutMs: 120_000,
    })
  }, 120_000)

  test('captures the Button examples', async () => {
    await app.visit('/components/button', { ...NETWORK }, async page => {
      await page.waitForSelector('.button-examples')
      await matchScreenshot(page.locator('.button-examples').first(), 'button examples', {
        maxDiffPixelRatio: 0.01,
      })
    })
  }, 60_000)

  test('captures the icon grid', async () => {
    await app.visit('/icons', { ...NETWORK }, async page => {
      await page.waitForSelector('.icon-grid')
      await matchScreenshot(page.locator('.icon-grid'), 'icon grid', {
        maxDiffPixelRatio: 0.01,
      })
    })
  }, 60_000)

  test('captures the whole icons page', async () => {
    await app.visit('/icons', { ...NETWORK }, async page => {
      await page.waitForSelector('.icon-grid')
      /*
       * The docs shell is `100vh` with an inner scroll region, so a full-page
       * capture would otherwise be the viewport. Release the shell height so the
       * snapshot is the whole page.
       */
      await page.addStyleTag({
        content: `
          html, body, #root, .documentation-shell.component {
            height: auto !important;
            overflow: visible !important;
          }
          .documentation-shell.component > main, .documentation-shell.component > nav.links {
            overflow: visible !important;
          }
        `,
      })
      // Wait for the real Shiki output so the captured code is highlighted.
      if (await page.locator('.code.component').count() > 0) {
        await page.waitForSelector('.code.component pre.shiki', { timeout: 30_000 })
      }
      /*
       * The tall page is mostly prose, so give it a slightly wider budget to
       * absorb small cross-machine rasterisation differences.
       */
      await matchScreenshot(page, 'full page', {
        maxDiffPixelRatio: 0.02,
      })
    })
  }, 60_000)

  /*
   * The Popup boundary example anchors the same tooltip in two panes: one clips
   * to the viewport only, the other names the pane as its boundary. The capture
   * is the visual contract for flip-and-shift against a scrolling container.
   */
  test('flips a Popup inside its clipping boundary', async () => {
    await app.visit('/mixins', { ...NETWORK }, async page => {
      await page.waitForSelector('.popup-boundary-example button')
      await matchScreenshot(page.locator('.popup-boundary-example'), 'popup boundary', {
        maxDiffPixelRatio: 0.02,
      })
    })
  }, 60_000)

  /*
   * Each Tooltip boundary scenario anchors an always-visible tooltip near a
   * different edge of a pane named as its boundary, so the snapshots cover flip
   * in every direction plus shift with an off-center arrow.
   */
  test('constrains tooltips to a boundary in every direction', async () => {
    await app.visit('/components/tooltip', { ...NETWORK }, async page => {
      await page.waitForSelector('.tooltip-boundary-examples')
      const scenarios = [
        ['top', 'top edge'],
        ['bottom', 'bottom edge'],
        ['left', 'left edge'],
        ['right', 'right edge'],
        ['top-right', 'top right shift'],
        ['bottom-left', 'bottom left shift'],
      ] as const
      for (const [scenario, hint] of scenarios) {
        await matchScreenshot(page.locator(`[data-tooltip-scenario="${scenario}"]`), hint, {
          maxDiffPixelRatio: 0.02,
        })
      }
    })
  }, 90_000)

  /*
   * The AutoComplete dropdown is promoted to the browser top layer, so these
   * assert the sizing contract Basis owns: it matches its editor, stays within
   * the viewport, wraps rich option content, and follows a named theme.
   */
  test('aligns the AutoComplete dropdown to its editor', async () => {
    await app.visit('/components/auto-complete', { ...NETWORK }, async page => {
      const search = page.locator('.auto-complete').first()
      const input = search.locator('input')
      const menu = search.locator('.popup-menu')

      await input.click()
      await input.fill('a')
      await page.waitForSelector('.auto-complete .popup-menu .menu-item.component')

      // Matches the editor width and stays within the viewport.
      const editor = await search.locator('.text-editor').boundingBox()
      const box = await menu.boundingBox()
      const viewportHeight = await page.evaluate(() => innerHeight)
      expect(Math.abs((box?.width ?? 0) - (editor?.width ?? 0))).toBeLessThanOrEqual(2)
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewportHeight)

      /*
       * Real wrapping: narrow the editor so a rich option cannot fit on one
       * line, then prove it wraps (no horizontal overflow, more than one line)
       * rather than asserting the declaration alone.
       */
      await page.addStyleTag({ content: '.auto-complete { width: 160px; }' })
      await page.waitForTimeout(150)
      const wrapped = await menu.locator('.menu-item.component').first().evaluate(el => ({
        clientWidth: el.clientWidth,
        height: el.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
        overflow: el.scrollWidth - el.clientWidth,
      }))
      expect(wrapped.overflow).toBeLessThanOrEqual(1)
      expect(wrapped.height).toBeGreaterThan(wrapped.lineHeight * 1.8)

      /*
       * Combobox semantics: the input owns the combobox role and controls a
       * listbox whose children are options. The active-descendant transition is
       * asserted after the snapshots so moving focus cannot change the captured
       * pixels.
       */
      expect(await input.getAttribute('role')).toBe('combobox')
      expect(await input.getAttribute('aria-expanded')).toBe('true')
      expect(await input.getAttribute('aria-autocomplete')).toBe('list')
      expect(await menu.getAttribute('role')).toBe('listbox')
      expect(await input.getAttribute('aria-controls')).toBe(await menu.getAttribute('id'))
      expect(await menu.locator('[role="option"]').count()).toBeGreaterThan(0)

      /*
       * Deterministic visual contract for the open dropdown (light). Text
       * anti-aliasing differs across machines, so allow the same budget the
       * other docs snapshots use.
       */
      await matchScreenshot(menu, 'open dropdown', { maxDiffPixelRatio: 0.02 })

      /*
       * The surface follows a named theme applied to a descendant. The theme is
       * injected because the docs app is light-only; the point is the token
       * flowing from the [data-theme] ancestor into the top-layer popup.
       */
      await page.addStyleTag({
        content: [
          ':root [data-theme="verify"] {',
          '  --basis-color-background: #000000;',
          '  --basis-color-foreground: #ffffff;',
          '}',
        ].join(' '),
      })
      await page.evaluate(() => document.querySelector('.auto-complete')?.setAttribute('data-theme', 'verify'))
      const background = await menu.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(background).toBe('rgb(0, 0, 0)')
      await matchScreenshot(menu, 'open dropdown dark', { maxDiffPixelRatio: 0.02 })

      /*
       * Active-descendant focus model: options leave the Tab sequence and DOM
       * focus stays on the combobox while ArrowDown/ArrowUp move the active
       * option.
       */
      const optionTabIndexes = await menu.locator('[role="option"]').evaluateAll(
        elements => elements.map(element => element.getAttribute('tabindex')),
      )
      expect(optionTabIndexes.every(value => value === '-1')).toBe(true)

      await input.press('ArrowDown')
      await page.waitForFunction(() => (
        document.querySelector('.auto-complete input')?.getAttribute('aria-activedescendant') !== null
      ))
      const activeId = await input.getAttribute('aria-activedescendant')
      const optionIds = await menu.locator('[role="option"]').evaluateAll(
        elements => elements.map(element => element.id),
      )
      expect(optionIds).toContain(activeId)
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')

      await input.press('ArrowDown')
      expect(await input.getAttribute('aria-activedescendant')).not.toBe(activeId)
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')

      await input.press('ArrowUp')
      expect(await input.getAttribute('aria-activedescendant')).toBe(activeId)
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')

      // Escape closes the listbox and keeps focus on the combobox.
      await input.press('Escape')
      await page.waitForFunction(() => document.querySelector('.auto-complete [role="listbox"]') === null)
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')

      // Enter activates the active option and keeps focus on the combobox.
      await input.click()
      await input.press('ArrowDown')
      await input.press('Enter')
      await page.waitForFunction(() => document.querySelector('.auto-complete [role="listbox"]') === null)
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
    })
  }, 60_000)

  /**
   * Release the fixed documentation shell so a full-page capture is the whole
   * page rather than the viewport. Shared by the Mermaid captures.
   * @param page - The page whose shell to release.
   */
  async function releaseShell(page: Page): Promise<void> {
    await page.addStyleTag({
      content: `
        html, body, #root, .documentation-shell.component {
          height: auto !important;
          overflow: visible !important;
        }
        .documentation-shell.component > main, .documentation-shell.component > nav.links {
          overflow: visible !important;
        }
      `,
    })
  }

  /*
   * The Mermaid gallery renders every supported diagram type from the page
   * theme; the capture is the visual contract for the themed output.
   */
  test('captures the Mermaid gallery', async () => {
    await app.visit('/components/mermaid', { ...NETWORK }, async page => {
      // 1 basic usage + 2 theming examples + 12 gallery + 5 comparison diagrams.
      await page.waitForFunction(
        () => document.querySelectorAll('.mermaid-diagram .diagram svg').length >= 20,
        undefined,
        { timeout: 90_000 },
      )
      if (await page.locator('.code.component').count() > 0) {
        await page.waitForSelector('.code.component pre.shiki', { timeout: 30_000 })
      }
      await releaseShell(page)
      await matchScreenshot(page, 'mermaid gallery', { maxDiffPixelRatio: 0.02 })
    })
  }, 120_000)

  /*
   * A diagram follows the `Theme` around it. The default capture is the page
   * theme; the named capture is the same diagram inside a scoped dark `Theme`,
   * proving the tokens flow into the rendered SVG.
   */
  test('captures the Mermaid theming', async () => {
    await app.visit('/components/mermaid', { ...NETWORK }, async page => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-theme-example] .diagram svg').length >= 2,
        undefined,
        { timeout: 60_000 },
      )
      for (const example of ['default', 'named']) {
        await matchScreenshot(
          page.locator(`[data-theme-example="${example}"]`),
          example,
          { maxDiffPixelRatio: 0.02 },
        )
      }
    })
  }, 120_000)

  /*
   * Each diagram type on its own, so a reviewer can read the themed output
   * without the full-page capture's scale.
   */
  test('captures the Mermaid diagram types', async () => {
    await app.visit('/components/mermaid', { ...NETWORK }, async page => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-diagram] .diagram svg').length >= 12,
        undefined,
        { timeout: 60_000 },
      )
      const diagrams = page.locator('[data-diagram]')
      const total = await diagrams.count()
      for (let index = 0; index < total; index += 1) {
        const diagram = diagrams.nth(index)
        const name = await diagram.getAttribute('data-diagram')
        await matchScreenshot(
          diagram.locator('.mermaid-diagram'),
          name ?? `diagram-${index}`,
          { maxDiffPixelRatio: 0.02 },
        )
      }
    })
  }, 120_000)

  /*
   * The renderer comparison puts the shared diagram types through both Mermaid
   * and beautiful-mermaid, so the trade-off is visible in a single capture.
   */
  test('captures the Mermaid renderer comparison', async () => {
    await app.visit('/components/mermaid', { ...NETWORK }, async page => {
      await page.waitForFunction(
        () => document.querySelectorAll('[data-renderer-comparison] .beautiful-mermaid svg').length >= 5
          && document.querySelectorAll('[data-renderer-comparison] .mermaid-diagram .diagram svg').length >= 5,
        undefined,
        { timeout: 90_000 },
      )
      const rows = page.locator('[data-renderer-comparison]')
      const total = await rows.count()
      for (let index = 0; index < total; index += 1) {
        const row = rows.nth(index)
        const name = await row.getAttribute('data-renderer-comparison')
        await matchScreenshot(row, `compare ${name ?? index}`, { maxDiffPixelRatio: 0.02 })
      }
    })
  }, 120_000)
})
