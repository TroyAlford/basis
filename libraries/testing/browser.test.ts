import { describe, expect, test } from 'bun:test'
import { browserLaunchError, CHROMIUM_SYSTEM_LIBRARIES_HELP, missingSystemLibrary } from './browser'

/** A realistic Playwright launch error for a host missing an OS library. */
const MISSING_LIBRARY_LOG = [
  'launch: Target page, context or browser has been closed',
  'Browser logs:',
  '<launching> /root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
  '[pid=42][err] /root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome:',
  '  error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file:',
  '  No such file or directory',
  '[pid=42] <process did exit: exitCode=127, signal=null>',
].join('\n')

describe('chromium launch guidance', () => {
  test('names the exact remediation for missing system libraries', () => {
    expect(CHROMIUM_SYSTEM_LIBRARIES_HELP).toContain('bunx playwright install-deps chromium')
    expect(CHROMIUM_SYSTEM_LIBRARIES_HELP).toContain('root')
    expect(CHROMIUM_SYSTEM_LIBRARIES_HELP).toContain('never requires sudo')
  })

  test('extracts the missing shared library from the launch log', () => {
    expect(missingSystemLibrary(new Error(MISSING_LIBRARY_LOG))).toBe('libatk-1.0.so.0')
  })

  test('extracts the library from a single-line log too', () => {
    const line = 'foo: error while loading shared libraries: libnss3.so: cannot open shared object file'

    expect(missingSystemLibrary(line)).toBe('libnss3.so')
  })

  test('reports no library when the failure does not name one', () => {
    expect(missingSystemLibrary(new Error('Target page, context or browser has been closed'))).toBeNull()
  })

  test('leads with the detected library, ahead of the log dump', () => {
    const error = browserLaunchError(new Error(MISSING_LIBRARY_LOG))
    const detected = error.message.indexOf('Detected missing system library: libatk-1.0.so.0')

    expect(detected).toBeGreaterThanOrEqual(0)
    expect(detected).toBeLessThan(error.message.indexOf('Underlying error:'))
  })

  test('wraps a launch failure with remediation and preserves the cause', () => {
    const cause = new Error('Host system is missing dependencies to run browsers')
    const error = browserLaunchError(cause)

    expect(error.message).toContain('bunx playwright install-deps chromium')
    expect(error.message).toContain('Host system is missing dependencies to run browsers')
    expect((error as { cause?: unknown }).cause).toBe(cause)
  })

  test('still guides when no specific library is named', () => {
    const error = browserLaunchError(new Error('launch: Target page, context or browser has been closed'))

    expect(error.message).toContain('bunx playwright install-deps chromium')
    expect(error.message).not.toContain('Detected missing system library')
  })

  test('handles a non-Error cause', () => {
    expect(browserLaunchError('boom').message).toContain('boom')
  })
})
