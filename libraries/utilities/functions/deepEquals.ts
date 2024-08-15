type CompareItem<T> = [T, T]

export function deepEquals<T>(one: T, two: T): boolean {
	const queue: CompareItem<T>[] = [[one, two]]

	while (queue.length) {
		const [a, b] = queue.shift()

		// Check for strict equality first
		if (a === b) continue

		// Check for type equality
		const typeA = typeof a
		const typeB = typeof b
		if (typeA !== typeB) return false

		// If they are objects, check keys length, then queue each property for comparison
		if (a && b && typeA === 'object') {
			const keysA = Object.keys(a)
			const keysB = Object.keys(b)
			if (keysA.length !== keysB.length) return false

			for (const key of new Set([...keysA, ...keysB])) {
				if (!keysA.includes(key) || !keysB.includes(key)) return false
				queue.push([a[key], b[key]])
			}
		} else {
			// If they are not objects and not equal, they are different (e.g., function, symbol)
			return false
		}
	}

	return true
}
