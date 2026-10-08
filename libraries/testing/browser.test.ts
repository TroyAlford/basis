import { describe, expect, test } from 'bun:test'
import { DOCKER_UNAVAILABLE_HELP, dockerUnavailableError, parsePublishedPort, parseServerEndpoint, playwrightImage } from './browser'

describe('snapshot runtime guidance', () => {
  test('pins the container image to the installed Playwright version', () => {
    expect(playwrightImage('1.63.0')).toBe('mcr.microsoft.com/playwright:v1.63.0-noble')
  })

  test('names the exact remediation for a missing or stopped Docker daemon', () => {
    expect(DOCKER_UNAVAILABLE_HELP).toContain('Docker')
    expect(DOCKER_UNAVAILABLE_HELP).toContain('mcr.microsoft.com/playwright:v')
    expect(DOCKER_UNAVAILABLE_HELP).toContain('never launches a host browser')
  })

  test('wraps a startup failure with remediation and preserves the cause', () => {
    const cause = new Error('Cannot connect to the Docker daemon')
    const error = dockerUnavailableError(cause)

    expect(error.message).toContain('Docker')
    expect(error.message).toContain('Cannot connect to the Docker daemon')
    expect((error as { cause?: unknown }).cause).toBe(cause)
  })

  test('handles a non-Error cause', () => {
    expect(dockerUnavailableError('boom').message).toContain('boom')
  })
})

describe('run-server endpoint parsing', () => {
  test('extracts the endpoint from the container log', () => {
    const log = [
      'Listening on ws://127.0.0.1:46565/',
      '',
    ].join('\n')

    expect(parseServerEndpoint(log)).toBe('ws://127.0.0.1:46565/')
  })

  test('extracts the endpoint when the line is surrounded by output', () => {
    const log = 'starting\nListening on ws://127.0.0.1:3000/\nready'

    expect(parseServerEndpoint(log)).toBe('ws://127.0.0.1:3000/')
  })

  test('reports no endpoint before the server announces one', () => {
    expect(parseServerEndpoint('starting up\n')).toBeNull()
  })
})

describe('published port parsing', () => {
  test('extracts the host port Docker published', () => {
    expect(parsePublishedPort('127.0.0.1:32768')).toBe(32768)
  })

  test('extracts the port from IPv6 output', () => {
    expect(parsePublishedPort('[::1]:32768')).toBe(32768)
  })

  test('reports no port when nothing is published', () => {
    expect(parsePublishedPort('')).toBeNull()
  })
})
