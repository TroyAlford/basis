import { describe, expect, test } from 'bun:test'
import { ensureServeStaticConfig, SERVE_STATIC_PLUGIN } from './serve-static'

/**
 * Read the configured development-server plugins back out of a TOML document.
 * @param text - The TOML document to parse.
 * @returns The `[serve.static].plugins` array, or an empty array.
 */
function plugins(text: string): string[] {
  const parsed = Bun.TOML.parse(text) as { serve?: { static?: { plugins?: string[] } } }
  return parsed.serve?.static?.plugins ?? []
}

describe('ensureServeStaticConfig', () => {
  test('creates the section when the document is empty', () => {
    const { changed, text } = ensureServeStaticConfig('')

    expect(changed).toBe(true)
    expect(plugins(text)).toEqual([SERVE_STATIC_PLUGIN])
  })

  test('appends the section without disturbing existing content', () => {
    const existing = '# consumer config\n\n[test]\npreload = ["basis/testing/bun"]\n'
    const { changed, text } = ensureServeStaticConfig(existing)

    expect(changed).toBe(true)
    expect(text).toContain('# consumer config')
    expect(text).toContain('preload = ["basis/testing/bun"]')
    expect(plugins(text)).toEqual([SERVE_STATIC_PLUGIN])
  })

  test('inserts the plugin into an existing section that has no plugins key', () => {
    const existing = '[serve.static]\nsomeSetting = true\n'
    const { changed, text } = ensureServeStaticConfig(existing)

    expect(changed).toBe(true)
    expect(text).toContain('someSetting = true')
    expect(plugins(text)).toEqual([SERVE_STATIC_PLUGIN])
  })

  test('extends an existing single-line plugins array', () => {
    const existing = '[serve.static]\nplugins = ["./local.ts"]\n'
    const { changed, text } = ensureServeStaticConfig(existing)

    expect(changed).toBe(true)
    expect(plugins(text)).toEqual(['./local.ts', SERVE_STATIC_PLUGIN])
  })

  test('extends a multiline plugins array', () => {
    const existing = '[serve.static]\nplugins = [\n  "./local.ts",\n]\n'
    const { changed, text } = ensureServeStaticConfig(existing)

    expect(changed).toBe(true)
    expect(plugins(text)).toEqual(['./local.ts', SERVE_STATIC_PLUGIN])
  })

  test('is idempotent once the plugin is configured', () => {
    const configured = '[serve.static]\nplugins = ["basis/serve"]\n'
    const { changed, text } = ensureServeStaticConfig(configured)

    expect(changed).toBe(false)
    expect(text).toBe(configured)
  })

  test('fails loudly when plugins is not an array', () => {
    expect(() => ensureServeStaticConfig('[serve.static]\nplugins = "nope"\n')).toThrow(/must be an array/)
  })

  test('leaves a malformed document parseable', () => {
    const existing = '[test]\npreload = ["basis/testing/bun"]\n'
    const { text } = ensureServeStaticConfig(existing)

    expect(() => Bun.TOML.parse(text)).not.toThrow()
  })
})
