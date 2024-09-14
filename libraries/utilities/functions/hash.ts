interface Options {
  characters: string,
  length: number,
  padWith: string,
  prefix: string,
}

const DEFAULTS: Options = {
  characters: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  length: undefined,
  padWith: '-',
  prefix: '',
}

/**
 * Hashes a value into a string
 * @param value the value to hash
 * @param options the options to hash with
 * @returns the hashed value
 */
export function hash(value: unknown, options: Partial<Options> = {}): string {
  const { characters, length, padWith, prefix }: Options = { ...DEFAULTS, ...options }
  if ([null, undefined].includes(value)) return null

  const json = JSON.stringify(value)
  let number = 0
  for (let i = 0; i < json.length; i++) {
    number = ((number << 5) - number) + json.charCodeAt(i)
    number |= 0 // Convert to 32bit integer
  }
  number = Math.abs(number)

  let string = ''
  while (number > 0) {
    string += characters[number % characters.length]
    number = Math.floor(number / characters.length)
  }

  const full = `${prefix}${string}`

  return full
    .padEnd(length ?? full.length, padWith)
    .substring(0, length)
}
