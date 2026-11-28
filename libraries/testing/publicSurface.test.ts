import { describe, expect, test } from 'bun:test'
import * as testing from './index'

describe('basis/testing public database surface', () => {
  test('exports one consumer database fixture', () => {
    expect(typeof testing.withDatabase).toBe('function')
    for (const name of [
      'useDatabaseFixture',
      'withCommittedDatabase',
      'withDurableDatabase',
      'withLifecycleDatabase',
    ]) {
      expect(name in testing).toBe(false)
    }
  })
})
