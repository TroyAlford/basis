/**
 * Resolve the test file that invoked the current code.
 *
 * Bun exposes no test-path API to custom matchers (there is no
 * `expect.getState()`), so the calling frame is read from the stack; frames from
 * `node_modules` and non-test files are skipped. The harness modules are named
 * `test.ts`/`cleanup.ts`, not `*.test.ts`, so they never match.
 * @returns The caller's file path, or null when none can be found.
 */
export function callerFile(): string | null {
  const stack = new Error().stack ?? ''
  for (const line of stack.split('\n')) {
    const match = line.match(/\(?((?:\/|file:\/\/)[^()\s]+?):\d+:\d+\)?$/)
    if (!match) continue
    const file = match[1].replace(/^file:\/\//, '')
    if (file.includes('node_modules')) continue
    if (!/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue
    return file
  }
  return null
}
