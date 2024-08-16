export const waitFor = <T>(
	callback: () => T | Promise<T>,
	options: {
		interval?: number,
		maxAttempts?: number,
		timeout?: number,
	} = {},
): Promise<T> => new Promise<T>((resolve, reject) => {
	const { interval = 1000, maxAttempts = 3, timeout = 10000 } = options
	const TIMERS = {
		attempt: null,
		timeout: null,
	}
	let attempts = 0
	let resolved = false

	TIMERS.timeout = setTimeout(reject, timeout)

	const attempt = async () => {
		if (attempts > maxAttempts) {
			clearTimeout(TIMERS.attempt)
			clearTimeout(TIMERS.timeout)
			return reject()
		}
		if (resolved) return true

		attempts += 1
		const result = await callback()

		if (resolved) return true
		if (result) {
			clearTimeout(TIMERS.attempt)
			clearTimeout(TIMERS.timeout)
			resolved = true
			return resolve(result)
		}

		return false
	}

	TIMERS.attempt = setInterval(attempt, interval)
})
