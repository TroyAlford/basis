import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { pluginLESS } from '../pluginLESS'

const FIXTURE_FILE = path.join(import.meta.dir, 'input.test.less')
const JS_FILEPATH = './input.test.js'

describe('pluginLESS', () => {
  test.each([true, false])('minified: %p', async minify => {
    const build = await Bun.build({
      entrypoints: [FIXTURE_FILE],
      plugins: [pluginLESS({ minify })],
      target: 'browser',
    })

    expect(build.outputs).toHaveLength(1)
    expect(build.outputs.map(file => file.path)).toMatchSnapshot()
    const js = build.outputs.find(file => file.path === JS_FILEPATH)
    expect(await js.text()).toMatchSnapshot()
  })
})
