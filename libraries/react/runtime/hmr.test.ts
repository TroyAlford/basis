import { describe, expect, test } from 'bun:test'
import { attachRoot, register } from './hmr'

describe('production HMR runtime', () => {
  test('keeps the first class and copies updated members onto it', async () => {
    class First {
      static displayName = 'First'
      render() {
        return 'one'
      }
    }

    const stable = register('runtime:first', First)
    expect(stable).toBe(First)

    class Second {
      static displayName = 'Second'
      render() {
        return 'two'
      }
      added() {
        return 'added'
      }
    }

    expect(register('runtime:first', Second) as unknown).toBe(First)
    expect(new First().render()).toBe('two')
    expect((new First() as unknown as Second).added()).toBe('added')
    expect(First.displayName).toBe('Second')
  })

  test('removes members the new class no longer declares', () => {
    class First {
      stale() {
        return 'stale'
      }
    }

    register('runtime:removed', First)

    class Second {
      fresh() {
        return 'fresh'
      }
    }

    register('runtime:removed', Second)

    expect('stale' in First.prototype).toBe(false)
    expect((new First() as unknown as Second).fresh()).toBe('fresh')
  })

  test('replaces the class when its base class changes', () => {
    class BaseA {
      base = 'a'
    }
    class First extends BaseA {
      first() {
        return 1
      }
    }

    register('runtime:base', First)

    class BaseB {
      base = 'b'
    }
    class Second extends BaseB {
      second() {
        return 2
      }
    }

    expect(register('runtime:base', Second)).toBe(Second)
  })

  test('replaces a class with runtime-private members so React remounts it', () => {
    class First {
      #value = 1
      read() {
        return this.#value
      }
    }

    register('runtime:private', First, true)

    class Second {
      #value = 2
      read() {
        return this.#value
      }
    }

    expect(register('runtime:private', Second, true)).toBe(Second)
    expect(new Second().read()).toBe(2)
  })

  test('batches updates into one root render', async () => {
    let renders = 0
    attachRoot(() => { renders += 1 })

    class First {
      first() {
        return 1
      }
    }
    class Second {
      second() {
        return 2
      }
    }
    register('runtime:render-a', First)
    register('runtime:render-b', First)
    register('runtime:render-a', Second)
    register('runtime:render-b', Second)

    expect(renders).toBe(0)
    await Promise.resolve()
    expect(renders).toBe(1)
  })
})
