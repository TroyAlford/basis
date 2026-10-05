import { describe, expect, test } from 'bun:test'
import * as configuration from './index'

describe('basis/configuration public surface', () => {
  test('exposes only the supported primitives', () => {
    expect(Object.keys(configuration).sort()).toEqual([
      'Environment',
      'SecretReadError',
      'loadEnvironment',
      'requireCommands',
      'run',
      'secret',
    ])
  })
})
