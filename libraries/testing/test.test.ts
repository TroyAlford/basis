import { expect } from 'bun:test'
import { currentTestName, describe, nextSnapshotIndex, test } from './test'

describe('testing/test', () => {
  test('tracks the composed test name', () => {
    expect(currentTestName()).toBe('testing/test tracks the composed test name')
  })

  test('counts per snapshot key', () => {
    expect(nextSnapshotIndex('alpha')).toBe(1)
    expect(nextSnapshotIndex('alpha')).toBe(2)
    expect(nextSnapshotIndex('beta')).toBe(1)
  })
})
