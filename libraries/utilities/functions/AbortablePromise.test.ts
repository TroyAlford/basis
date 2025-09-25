import { describe, expect, test } from 'bun:test'
import { AbortablePromise } from './AbortablePromise'
import { noop } from './noop'

describe('AbortablePromise', () => {
  test('should resolve with the correct value', async () => {
    const promise = new AbortablePromise<string>(resolve => {
      setTimeout(() => resolve('success'), 10)
    })

    const result = await promise
    expect(result).toBe('success')
  })

  test('should reject with the correct error', async () => {
    const promise = new AbortablePromise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('test error')), 10)
    })

    await expect(promise).rejects.toThrow('test error')
  })

  test('should abort and reject with AbortError', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      signal.addEventListener('abort', () => {
        reject(new Error('AbortError'))
      })

      setTimeout(() => resolve('success'), 100)
    })

    // Abort immediately
    promise.abort()

    await expect(promise).rejects.toThrow('AbortError')
  })

  test('should abort a promise that takes time to resolve', async () => {
    let resolved = false
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      const timeout = setTimeout(() => {
        if (!signal.aborted) {
          resolved = true
          resolve('success')
        }
      }, 100)

      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('AbortError'))
      })
    })

    // Abort after 50ms
    setTimeout(() => promise.abort(), 50)

    await expect(promise).rejects.toThrow('AbortError')

    // Wait a bit to ensure the original timeout didn't resolve
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(resolved).toBe(false)
  })

  test('should handle multiple abort calls gracefully', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      signal.addEventListener('abort', () => {
        reject(new Error('AbortError'))
      })

      setTimeout(() => resolve('success'), 100)
    })

    promise.abort()
    promise.abort() // Second abort should not throw
    promise.abort() // Third abort should not throw

    await expect(promise).rejects.toThrow('AbortError')
  })

  test('should work with then() method', async () => {
    const promise = new AbortablePromise<number>(resolve => {
      setTimeout(() => resolve(42), 10)
    })

    const result = await promise.then(value => value * 2)
    expect(result).toBe(84)
  })

  test('should work with catch() method', async () => {
    const promise = new AbortablePromise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('test error')), 10)
    })

    const result = await promise.catch((error: Error) => `caught: ${error.message}`)
    expect(result).toBe('caught: test error')
  })

  test('should work with finally() method', async () => {
    let finallyCalled = false
    const promise = new AbortablePromise<string>(resolve => {
      setTimeout(() => resolve('success'), 10)
    })

    const result = await promise.finally(() => {
      finallyCalled = true
    })

    expect(result).toBe('success')
    expect(finallyCalled).toBe(true)
  })

  test('should preserve abort functionality through then()', async () => {
    const promise = new AbortablePromise<number>((resolve, reject, signal) => {
      const timeout = setTimeout(() => resolve(42), 100)

      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('AbortError'))
      })
    }, { timeout: 200 })

    const chainedPromise = promise.then(value => value * 2)

    // Abort the original promise
    promise.abort()

    await expect(chainedPromise).rejects.toThrow('AbortError')
  })

  test('should preserve abort functionality through catch()', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      const timeout = setTimeout(() => reject(new Error('test error')), 100)

      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('AbortError'))
      })
    }, { timeout: 200 })

    const chainedPromise = promise.catch((error: Error) => {
      if (error.message === 'AbortError') {
        throw error // Re-throw abort errors
      }
      return `caught: ${error.message}`
    })

    // Abort the original promise
    promise.abort()

    await expect(chainedPromise).rejects.toThrow('AbortError')
  })

  test('should preserve abort functionality through finally()', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      const timeout = setTimeout(() => resolve('success'), 100)

      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('AbortError'))
      })
    }, { timeout: 200 })

    const chainedPromise = promise.finally(noop)

    // Abort the original promise
    promise.abort()

    await expect(chainedPromise).rejects.toThrow('AbortError')
  })

  test('should work with complex chaining', async () => {
    const promise = new AbortablePromise<number>(resolve => {
      setTimeout(() => resolve(10), 10)
    })

    const result = await promise
      .then(value => value * 2)
      .then(value => value + 5)
      .catch(() => 0)
      .finally(noop)

    expect(result).toBe(25)
  })

  test('should handle abort signal in executor', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      signal.addEventListener('abort', () => {
        reject(new Error('Custom abort handler'))
      })

      setTimeout(() => {
        if (!signal.aborted) {
          resolve('success')
        }
      }, 100)
    })

    setTimeout(() => promise.abort(), 50)

    await expect(promise).rejects.toThrow('Custom abort handler')
  })

  test('should work with async executor', async () => {
    const promise = new AbortablePromise<string>(async resolve => {
      await new Promise(ok => setTimeout(ok, 10))
      resolve('async success')
    })

    const result = await promise
    expect(result).toBe('async success')
  })

  test('should handle promise rejection in async executor', async () => {
    const promise = new AbortablePromise<string>(async (resolve, reject) => {
      await new Promise(ok => setTimeout(ok, 10))
      reject(new Error('async error'))
    })

    await expect(promise).rejects.toThrow('async error')
  })

  test('should auto-timeout after default 1000ms', async () => {
    const promise = new AbortablePromise<string>(resolve => {
      // Never resolve - should timeout
      setTimeout(() => resolve('success'), 2000)
    })

    await expect(promise).rejects.toThrow('TimeoutError')
  })

  test('should auto-timeout after custom timeout', async () => {
    const promise = new AbortablePromise<string>(resolve => {
      // Never resolve - should timeout after 100ms
      setTimeout(() => resolve('success'), 200)
    }, { timeout: 100 })

    await expect(promise).rejects.toThrow('TimeoutError')
  })

  test('should not timeout if promise resolves before timeout', async () => {
    const promise = new AbortablePromise<string>(resolve => {
      setTimeout(() => resolve('success'), 100)
    }, { timeout: 500 })

    const result = await promise
    expect(result).toBe('success')
  })

  test('should not timeout if promise rejects before timeout', async () => {
    const promise = new AbortablePromise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('test error')), 100)
    }, { timeout: 500 })

    await expect(promise).rejects.toThrow('test error')
  })

  test('should not timeout if promise is aborted before timeout', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      signal.addEventListener('abort', () => {
        reject(new Error('AbortError'))
      })

      setTimeout(() => resolve('success'), 200)
    }, { timeout: 500 })

    setTimeout(() => promise.abort(), 100)

    await expect(promise).rejects.toThrow('AbortError')
  })
})
