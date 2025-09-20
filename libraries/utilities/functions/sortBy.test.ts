import { describe, expect, test } from 'bun:test'
import { sortBy } from './sortBy'

describe('sortBy', () => {
  test('should sort by string values', () => {
    const users = [
      { age: 30, name: 'John' },
      { age: 25, name: 'Jane' },
      { age: 35, name: 'Bob' },
    ]

    const sortedByName = sortBy(users, user => user.name)
    expect(sortedByName).toEqual([
      { age: 35, name: 'Bob' },
      { age: 25, name: 'Jane' },
      { age: 30, name: 'John' },
    ])
  })

  test('should sort by number values', () => {
    const users = [
      { age: 30, name: 'John' },
      { age: 25, name: 'Jane' },
      { age: 35, name: 'Bob' },
    ]

    const sortedByAge = sortBy(users, user => user.age)
    expect(sortedByAge).toEqual([
      { age: 25, name: 'Jane' },
      { age: 30, name: 'John' },
      { age: 35, name: 'Bob' },
    ])
  })

  test('should sort by boolean values', () => {
    const items = [
      { active: false, name: 'Item 1' },
      { active: true, name: 'Item 2' },
      { active: false, name: 'Item 3' },
    ]

    const sortedByActive = sortBy(items, item => item.active)
    expect(sortedByActive).toEqual([
      { active: false, name: 'Item 1' },
      { active: false, name: 'Item 3' },
      { active: true, name: 'Item 2' },
    ])
  })

  test('should handle empty arrays', () => {
    expect(sortBy([], x => x)).toEqual([])
  })

  test('should handle single element arrays', () => {
    expect(sortBy([1], x => x)).toEqual([1])
  })
})
