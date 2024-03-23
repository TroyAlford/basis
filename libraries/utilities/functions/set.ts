export function set<V = object>(path: string, object: V, value: unknown): unknown {
	const keys = path.split('.')

	let current = object
	keys.forEach((key, index) => {
		if (index === keys.length - 1) {
			current[key] = value
		} else if (current[key] === undefined) {
			current[key] = {}
		}

		current = current[key]
	})

	return object
}