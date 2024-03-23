export function get<O = unknown, V = unknown>(
	path: string,
	from: O,
	defaultValue?: V
): V | undefined {
	let value = from
	for (const key of path.split('.')) {
		value = value?.[key]
		if (value === undefined) return defaultValue
	}

	return value as unknown as V
}