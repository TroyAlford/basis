import { describe, expect, test } from 'bun:test'
import { browserConnectError, DOCKER_BROWSER_HELP } from './browser'

/** A stand-in container endpoint for error-message assertions. */
const ENDPOINT = 'ws://127.0.0.1:42987/'

describe('browserConnectError', () => {
  test('names the endpoint and remediation', () => {
    const error = browserConnectError(ENDPOINT, new Error('connection refused'))

    expect(error.message).toContain(ENDPOINT)
    expect(error.message).toContain('connection refused')
    expect(error.message).toContain('runs every snapshot capture through a Docker container')
  })

  test('preserves the underlying cause', () => {
    const cause = new Error('boom')

    expect((browserConnectError(ENDPOINT, cause) as { cause?: unknown }).cause).toBe(cause)
  })

  test('handles a non-Error cause', () => {
    expect(browserConnectError(ENDPOINT, 'nope').message).toContain('nope')
  })

  test('guidance names the host-dependency declaration', () => {
    expect(DOCKER_BROWSER_HELP).toContain('basis.hostDependencies')
  })
})
