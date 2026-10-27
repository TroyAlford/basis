import { beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { ApplicationHandle } from '../../../testing'
import { matchScreenshot, test, useApplication } from '../../../testing'

const ROOT = join(import.meta.dir, '..', '..', '..', '..')

let app: ApplicationHandle

beforeAll(async () => {
  app = await useApplication({
    cwd: ROOT,
    entry: './testing/components/serve.ts',
    timeoutMs: 120_000,
  })
}, 120_000)

test('keeps the sticky header above pinned body cells while scrolling', async () => {
  const result = await app.visit('/table', async page => {
    const table = page.locator('.table.editor.component')
    await table.waitFor()

    await table.evaluate(element => { element.scrollTop = 60 })
    await page.waitForTimeout(100)

    const geometry = await table.evaluate(element => {
      const tableBox = element.getBoundingClientRect()
      const headerRow = element.querySelector('thead tr') as HTMLElement
      const headerBox = headerRow.getBoundingClientRect()
      const fields = ['name', 'value', 'actions']

      return {
        headerPinned: Math.abs(headerBox.top - tableBox.top) <= 1,
        probes: fields.map(field => {
          const cell = element.querySelector(`thead th[data-field="${field}"]`) as HTMLElement
          const box = cell.getBoundingClientRect()
          const target = document.elementFromPoint(
            box.left + (box.width / 2),
            box.top + (box.height / 2),
          )
          return target?.closest('thead') !== null && target !== null
        }),
        scrolled: element.scrollTop > 0,
      }
    })

    await matchScreenshot(page.locator('#stage'), 'scrolled pinned table', {
      maxDiffPixelRatio: 0.02,
    })

    return geometry
  })

  expect(result.scrolled).toBe(true)
  expect(result.probes).toEqual([true, true, true])
  expect(result.headerPinned).toBe(true)
}, 120_000)

test('stacks a pinned-cell tooltip above the sticky header', async () => {
  const result = await app.visit('/table-tooltip', async page => {
    const table = page.locator('.table.editor.component')
    await table.waitFor()

    const tooltip = page.locator('.tooltip.component[data-visible="true"]')
    await tooltip.waitFor()
    await page.waitForFunction(() => {
      const tip = document.querySelector<HTMLElement>('.tooltip.component[data-visible="true"]')
      return (tip?.getBoundingClientRect().height ?? 0) > 0
    })
    await page.waitForTimeout(150)

    const geometry = await page.evaluate(() => {
      const tip = document.querySelector('.tooltip.component[data-visible="true"]') as HTMLElement
      const header = document.querySelector('thead') as HTMLElement
      const tipBox = tip.getBoundingClientRect()
      const headerBox = header.getBoundingClientRect()

      // Tooltips are pointer-transparent, so enable hit testing for the paint-order check.
      tip.style.pointerEvents = 'auto'
      const target = document.elementFromPoint(
        tipBox.left + (tipBox.width / 2),
        tipBox.top + (tipBox.height / 2),
      )
      tip.style.removeProperty('pointer-events')

      return {
        onTop: target !== null && (target === tip || tip.contains(target)),
        overlapsHeader: tipBox.bottom > headerBox.top && tipBox.top < headerBox.bottom,
      }
    })

    await matchScreenshot(page.locator('#stage'), 'tooltip above sticky header', {
      maxDiffPixelRatio: 0.02,
    })

    return geometry
  })

  expect(result.overlapsHeader).toBe(true)
  expect(result.onTop).toBe(true)
}, 120_000)
