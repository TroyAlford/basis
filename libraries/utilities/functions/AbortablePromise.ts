import type { Abortable } from '../../types/Abortable'

type Resolve<T> = (value: T) => void
type Reject = (reason?: unknown) => void
type Executor<T> = (resolve: Resolve<T>, reject: Reject, signal: AbortSignal) => void

interface AbortablePromiseOptions {
  timeout?: number,
}

export class AbortablePromise<T> extends Promise<T> implements Abortable<Promise<T>> {
  private abortController: AbortController
  private timeoutId?: Timer

  constructor(executor: Executor<T>, options: AbortablePromiseOptions = {}) {
    const abortController = new AbortController()
    const { timeout = 1000 } = options
    let timeoutId: Timer

    super((resolve, reject) => {
      // Set up auto-timeout
      timeoutId = setTimeout(() => {
        abortController.abort()
        reject(new Error('TimeoutError'))
      }, timeout)

      // Clear timeout if promise resolves/rejects before timeout
      const originalResolve = resolve
      const originalReject = reject

      resolve = (value: T) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        originalResolve(value)
      }

      reject = (reason?: unknown) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        originalReject(reason)
      }

      executor(resolve, reject, abortController.signal)
    })

    this.abortController = abortController
    this.timeoutId = timeoutId
  }

  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }

  abort(): void {
    this.clearTimeout()
    this.abortController.abort()
  }

  then<TResult1 = T, TResult2 = never>(
    onResolve?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onReject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): AbortablePromise<TResult1 | TResult2> {
    const result = super.then(onResolve, onReject)
    return Object.assign(result, { abort: () => this.abort() }) as AbortablePromise<TResult1 | TResult2>
  }

  catch<TResult = never>(
    onCatch?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
  ): AbortablePromise<T | TResult> {
    const result = super.catch(onCatch)
    return Object.assign(result, { abort: () => this.abort() }) as AbortablePromise<T | TResult>
  }

  finally(onFinally?: (() => void) | undefined | null): AbortablePromise<T> {
    const result = super.finally(onFinally)
    return Object.assign(result, { abort: () => this.abort() }) as AbortablePromise<T>
  }
}
