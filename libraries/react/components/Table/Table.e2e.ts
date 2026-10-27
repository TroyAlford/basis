import { expect } from 'bun:test'
import { join } from 'node:path'
import { test, useApplication } from '../../../testing'

const ROOT = join(import.meta.dir, '..', '..', '..', '..')

test('keeps the sticky header above pinned body cells while scrolling', async () => {
  const app = await useApplication({
    cwd: ROOT,
    entry: './testing/components/index.ts',
    timeoutMs: 120_000,
  })

  const result = await app.visit('/table', async page => {
    const table = page.locator('.table.editor.component')
    await table.waitFor()

    /*
     * Chromium does not honor z-index on table rows consistently. Removing any
     * row-level layer models the reported failure and proves the header's
     * guarantee comes from the row group rather than a table row.
     */
    await page.addStyleTag({
      content: 'thead tr { isolation: auto !important; z-index: auto !important; }',
    })

    await table.evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.waitForTimeout(100)

    return table.evaluate(element => {
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
  })

  await app.stop()

  expect(result.scrolled).toBe(true)
  expect(result.probes).toEqual([true, true, true])
  expect(result.headerPinned).toBe(true)
}, 120_000)
