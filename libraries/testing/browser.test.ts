import { describe, expect, test } from 'bun:test'
import { browserLaunchError, CHROMIUM_SYSTEM_LIBRARIES_HELP } from './browser'

describe('chromium launch guidance', () => {
  test('names the exact remediation for missing system libraries', () => {
    expect(CHROMIUM_SYSTEM_LIBRARIES_HELP).toContain('bunx playwright install-deps chromium')
    expect(CHROMIUM_SYSTEM_LIBRARIES_HELP).toContain('root')
    expect(CHROMIUM_SYSTEM_LIBRARIES_HELP).toContain('never requires sudo')
  })

  test('wraps a launch failure with remediation and preserves the cause', () => {
    const cause = new Error('Host system is missing dependencies to run browsers')
    const error = browserLaunchError(cause)

    expect(error.message).toContain('bunx playwright install-deps chromium')
    expect(error.message).toContain('Host system is missing dependencies to run browsers')
    expect((error as { cause?: unknown }).cause).toBe(cause)
  })

  test('handles a non-Error cause', () => {
    expect(browserLaunchError('boom').message).toContain('boom')
  })
})
