/**
 * Normalize one block of formatted indented text for comparison.
 * @param value - Text to normalize.
 * @returns Lines with the common baseline indentation removed.
 */
export function indentedLines(value: unknown): string[] {
  if (typeof value !== 'string') throw new TypeError('toMatchIndented expects strings')
  const lines = value.replace(/\r\n/gu, '\n').split('\n')
  while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop()
  const first = lines.find(line => line.trim() !== '')
  const baseline = first?.match(/^\s*/u)?.[0] ?? ''
  return lines.map(line => {
    if (line.trim() === '') return ''
    if (!line.startsWith(baseline)) {
      throw new Error(`Text line is less indented than the baseline:\n${line}`)
    }
    return line.slice(baseline.length).replace(/\s+$/u, '')
  })
}

/**
 * Compare two blocks of formatted indented text after removing their baseline indentation.
 * @param actual - Received text.
 * @param expected - Expected text.
 * @returns Matcher result.
 */
export function toMatchIndented(actual: unknown, expected: unknown): { message: () => string, pass: boolean } {
  let received: string[]
  let wanted: string[]
  try {
    received = indentedLines(actual)
    wanted = indentedLines(expected)
  } catch (error) {
    return {
      message: () => (error instanceof Error ? error.message : String(error)),
      pass: false,
    }
  }
  const pass = received.length === wanted.length
    && received.every((line, index) => line === wanted[index])
  return {
    message: () => `
Expected text:
${wanted.join('\n')}
Received text:
${received.join('\n')}
    `.trim(),
    pass,
  }
}
