import { describe, expect } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newPage, visualTest } from '../index'
import { artifactPath, screenshotPath } from '../snapshots'
import { toMatchScreenshot } from './toMatchScreenshot'

describe('testing/toMatchScreenshot', () => {
  visualTest('writes a baseline, then matches the same render', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'basis-visual-'))
    const page = await newPage()
    await page.setContent('<h1 style="font-family: sans-serif">hello visual</h1>')

    const first = await toMatchScreenshot(page, 'hello', { dir })
    expect(first.pass).toBe(true)
    expect(existsSync(screenshotPath('hello', { dir }))).toBe(true)

    const second = await toMatchScreenshot(page, 'hello', { dir })
    expect(second.pass).toBe(true)
  })

  visualTest('fails and writes artifacts when the render changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'basis-visual-'))
    const page = await newPage()
    await page.setContent('<h1 style="font-family: sans-serif">one</h1>')
    expect((await toMatchScreenshot(page, 'change', { dir })).pass).toBe(true)

    await page.setContent('<h1 style="font-family: sans-serif; color: red">two</h1>')
    const failure = await toMatchScreenshot(page, 'change', { dir })
    expect(failure.pass).toBe(false)
    expect(existsSync(artifactPath('change', 'actual', { dir }))).toBe(true)
    expect(existsSync(artifactPath('change', 'diff', { dir }))).toBe(true)
  })
})
