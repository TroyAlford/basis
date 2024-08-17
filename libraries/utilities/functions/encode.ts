export function encode<V = unknown>(value: V): `H-${string}` {
  if ([null, undefined].includes(value)) return null

  const jsonString = JSON.stringify(value)
  const base64 = Buffer.from(jsonString)
    .toString('base64')
    .replace(/=+$/, '')	// Remove trailing '='
  return `H-${base64}`  // Ensure it starts with a letter
}

export function decode<V>(hashed: `H-${string}`): V {
  if (!hashed.startsWith('H-')) throw new Error('Invalid hash')

  const base64 = hashed.slice(2)
  const jsonString = Buffer.from(base64, 'base64').toString()
  return JSON.parse(jsonString)
}
