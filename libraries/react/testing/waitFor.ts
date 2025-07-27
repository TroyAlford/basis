type Callback<T> = () => T | Promise<T>

interface Options {
  interval?: number,
  maxAttempts?: number,
  timeout?: number,
}

export const waitFor = <T>(callback: Callback<T>, options: Options = {}): Promise<T> => (
  new Promise<T>((resolve, reject) => {
    const { interval = 20, maxAttempts, timeout = 2_000 } = options
    const expiry: Timer = setTimeout(
      () => reject(new Error('waitFor: timeout reached')),
      timeout,
    )

    let attempts = 0
    let resolved = false

    const clear = () => {
      clearTimeout(expiry)
    }

    const attempt = async () => {
      if (resolved) return true
      if (maxAttempts && attempts >= maxAttempts) {
        clear()
        return reject(new Error('waitFor: maxAttempts reached'))
      }

      attempts += 1

      try {
        const result = await callback()
        if (resolved) return true
        if (result) {
          resolved = true
          clear()
          return resolve(result)
        } else {
          setTimeout(attempt, interval)
        }
      } catch (error) {
        clear()
        reject(error)
      }

      return false
    }

    attempt()
  })
)
