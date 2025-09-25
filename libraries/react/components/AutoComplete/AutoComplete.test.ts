import { describe, expect, it } from 'bun:test'
import { AbortablePromise, noop } from '@basis/utilities'

describe('AutoComplete', () => {
  it('should create AbortablePromise with timeout for search operations', async () => {
    const searchPromise = new AbortablePromise<string[]>(resolve => {
      // Simulate a search that takes time
      setTimeout(() => resolve(['result1', 'result2']), 100)
    }, { timeout: 5000 })

    const results = await searchPromise
    expect(results).toEqual(['result1', 'result2'])
    expect(typeof searchPromise.abort).toBe('function')
  })

  it('should abort previous search when new search starts', async () => {
    let firstSearchAborted = false
    let secondSearchCompleted = false

    // First search (will be aborted)
    const firstSearch = new AbortablePromise<string[]>((resolve, reject, signal) => {
      signal.addEventListener('abort', () => {
        firstSearchAborted = true
        reject(new Error('AbortError'))
      })

      setTimeout(() => resolve(['first']), 200)
    }, { timeout: 1000 })

    // Second search (will complete)
    const secondSearch = new AbortablePromise<string[]>(resolve => {
      setTimeout(() => {
        secondSearchCompleted = true
        resolve(['second'])
      }, 100)
    }, { timeout: 1000 })

    // Start both searches
    const firstPromise = firstSearch.catch(noop) // Catch the abort error
    const secondPromise = secondSearch

    // Abort first search immediately
    firstSearch.abort()

    // Wait for second search to complete
    const secondResults = await secondPromise

    expect(firstSearchAborted).toBe(true)
    expect(secondSearchCompleted).toBe(true)
    expect(secondResults).toEqual(['second'])

    // First search should have been handled
    await firstPromise
  })

  it('should timeout slow search operations', async () => {
    const slowSearch = new AbortablePromise<string[]>(resolve => {
      // This will never resolve, should timeout
      setTimeout(() => resolve(['slow']), 6000)
    }, { timeout: 1000 })

    await expect(slowSearch).rejects.toThrow('TimeoutError')
  })

  it('should handle search with proper error handling', async () => {
    const searchWithError = new AbortablePromise<string[]>((resolve, reject) => {
      setTimeout(() => reject(new Error('Search failed')), 100)
    }, { timeout: 5000 })

    await expect(searchWithError).rejects.toThrow('Search failed')
  })

  it('should work with chained operations', async () => {
    const searchPromise = new AbortablePromise<number>(resolve => {
      setTimeout(() => resolve(42), 100)
    }, { timeout: 5000 })

    const chained = searchPromise
      .then(value => value * 2)
      .then(value => value + 10)

    const result = await chained
    expect(result).toBe(94)
    expect(typeof chained.abort).toBe('function')
  })

  it('should handle onSearch that returns undefined', async () => {
    const badOnSearch = () => undefined

    const promise = new AbortablePromise<string[]>((resolve, reject) => {
      const searchPromise = badOnSearch()
      if (searchPromise && typeof searchPromise.then === 'function') {
        searchPromise.then(resolve).catch(reject)
      } else {
        reject(new Error('onSearch must return a Promise'))
      }
    }, { timeout: 5000 })

    await expect(promise).rejects.toThrow('onSearch must return a Promise')
  })

  it('should handle onSearch that returns null', async () => {
    const badOnSearch = () => null

    const promise = new AbortablePromise<string[]>((resolve, reject) => {
      const searchPromise = badOnSearch()
      if (searchPromise && typeof searchPromise.then === 'function') {
        searchPromise.then(resolve).catch(reject)
      } else {
        reject(new Error('onSearch must return a Promise'))
      }
    }, { timeout: 5000 })

    await expect(promise).rejects.toThrow('onSearch must return a Promise')
  })
})
