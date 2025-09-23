import { AbortablePromise } from './AbortablePromise'

describe('AbortablePromise', () => {
  it('should resolve with the correct value', async () => {
    const promise = new AbortablePromise<string>((resolve) => {
      setTimeout(() => resolve('success'), 10)
    })

    const result = await promise
    expect(result).toBe('success')
  })

  it('should reject with the correct error', async () => {
    const promise = new AbortablePromise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('test error')), 10)
    })

    await expect(promise).rejects.toThrow('test error')
  })

  it('should abort and reject with AbortError', async () => {
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

  it('should abort a promise that takes time to resolve', async () => {
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

  it('should handle multiple abort calls gracefully', async () => {
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

  it('should work with then() method', async () => {
    const promise = new AbortablePromise<number>((resolve) => {
      setTimeout(() => resolve(42), 10)
    })

    const result = await promise.then(value => value * 2)
    expect(result).toBe(84)
  })

  it('should work with catch() method', async () => {
    const promise = new AbortablePromise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('test error')), 10)
    })

    const result = await promise.catch(error => `caught: ${error.message}`)
    expect(result).toBe('caught: test error')
  })

  it('should work with finally() method', async () => {
    let finallyCalled = false
    const promise = new AbortablePromise<string>((resolve) => {
      setTimeout(() => resolve('success'), 10)
    })

    const result = await promise.finally(() => {
      finallyCalled = true
    })

    expect(result).toBe('success')
    expect(finallyCalled).toBe(true)
  })

  it('should preserve abort functionality through then()', async () => {
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

  it('should preserve abort functionality through catch()', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      const timeout = setTimeout(() => reject(new Error('test error')), 100)

      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('AbortError'))
      })
    }, { timeout: 200 })

    const chainedPromise = promise.catch(error => {
      if (error.message === 'AbortError') {
        throw error // Re-throw abort errors
      }
      return `caught: ${error.message}`
    })

    // Abort the original promise
    promise.abort()

    await expect(chainedPromise).rejects.toThrow('AbortError')
  })

  it('should preserve abort functionality through finally()', async () => {
    const promise = new AbortablePromise<string>((resolve, reject, signal) => {
      const timeout = setTimeout(() => resolve('success'), 100)

      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('AbortError'))
      })
    }, { timeout: 200 })

    const chainedPromise = promise.finally(() => { })

    // Abort the original promise
    promise.abort()

    await expect(chainedPromise).rejects.toThrow('AbortError')
  })

  it('should work with complex chaining', async () => {
    const promise = new AbortablePromise<number>((resolve) => {
      setTimeout(() => resolve(10), 10)
    })

    const result = await promise
      .then(value => value * 2)
      .then(value => value + 5)
      .catch(() => 0)
      .finally(() => { })

    expect(result).toBe(25)
  })

  it('should handle abort signal in executor', async () => {
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

  it('should work with async executor', async () => {
    const promise = new AbortablePromise<string>(async (resolve) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      resolve('async success')
    })

    const result = await promise
    expect(result).toBe('async success')
  })

  it('should handle promise rejection in async executor', async () => {
    const promise = new AbortablePromise<string>(async (resolve, reject) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      reject(new Error('async error'))
    })

    await expect(promise).rejects.toThrow('async error')
  })

  it('should auto-timeout after default 1000ms', async () => {
    const promise = new AbortablePromise<string>((resolve) => {
      // Never resolve - should timeout
      setTimeout(() => resolve('success'), 2000)
    })

    await expect(promise).rejects.toThrow('TimeoutError')
  })

  it('should auto-timeout after custom timeout', async () => {
    const promise = new AbortablePromise<string>((resolve) => {
      // Never resolve - should timeout after 100ms
      setTimeout(() => resolve('success'), 200)
    }, { timeout: 100 })

    await expect(promise).rejects.toThrow('TimeoutError')
  })

  it('should not timeout if promise resolves before timeout', async () => {
    const promise = new AbortablePromise<string>((resolve) => {
      setTimeout(() => resolve('success'), 100)
    }, { timeout: 500 })

    const result = await promise
    expect(result).toBe('success')
  })

  it('should not timeout if promise rejects before timeout', async () => {
    const promise = new AbortablePromise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('test error')), 100)
    }, { timeout: 500 })

    await expect(promise).rejects.toThrow('test error')
  })

  it('should not timeout if promise is aborted before timeout', async () => {
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
