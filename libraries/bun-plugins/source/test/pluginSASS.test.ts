import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { pluginSASS } from '../pluginSASS'

const FIXTURE_FILE = path.join(import.meta.dir, 'input.test.scss')
const JS_FILEPATH = './input.test.js'

describe('pluginSASS', () => {
  test.each([true, false])('minified: %p', async minify => {
    const build = await Bun.build({
      entrypoints: [FIXTURE_FILE],
      plugins: [pluginSASS({ minify })],
      target: 'browser',
    })

    expect(build.outputs).toHaveLength(1)
    expect(build.outputs.map(file => file.path)).toMatchSnapshot()
    const js = build.outputs.find(file => file.path === JS_FILEPATH)
    expect(await js.text()).toMatchSnapshot()
  })
})
