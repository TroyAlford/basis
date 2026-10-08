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
  test('creates the fenced section when the document is empty', () => {
    const { changed, text } = ensureServeStaticConfig('')

    expect(changed).toBe(true)
    expect(plugins(text)).toEqual([SERVE_STATIC_PLUGIN])
  })

  test('appends the fence without disturbing existing content', () => {
    const existing = '# consumer config\n\n[test]\npreload = ["basis/testing/bun"]\n'
    const { changed, text } = ensureServeStaticConfig(existing)

    expect(changed).toBe(true)
    expect(text).toContain('# consumer config')
    expect(text).toContain('preload = ["basis/testing/bun"]')
    expect(plugins(text)).toEqual([SERVE_STATIC_PLUGIN])
  })

  test('is idempotent once fenced', () => {
    const first = ensureServeStaticConfig('')
    const second = ensureServeStaticConfig(first.text)

    expect(second.changed).toBe(false)
    expect(second.text).toBe(first.text)
  })

  test('replaces a stale fenced block', () => {
    const stale = [
      '# >>> basis:development-server >>>',
      '[serve.static]',
      'plugins = ["./old.ts"]',
      '# <<< basis:development-server <<<',
      '',
    ].join('\n')
    const { changed, text } = ensureServeStaticConfig(stale)

    expect(changed).toBe(true)
    expect(plugins(text)).toEqual([SERVE_STATIC_PLUGIN])
    expect(text).not.toContain('./old.ts')
  })

  test('leaves a document that already names the plugin alone', () => {
    const existing = '[serve.static]\nplugins = ["basis/serve"]\n'
    const { changed, text } = ensureServeStaticConfig(existing)

    expect(changed).toBe(false)
    expect(text).toBe(existing)
  })

  test('fails loudly on a mismatched fence', () => {
    expect(() => ensureServeStaticConfig('# >>> basis:development-server >>>\n')).toThrow(/marker/)
  })
})
