/**
 * The test-file suffixes Basis attributes to a source file.
 *
 * Bun's default discovery recognizes `.test` and `.spec`, so the fast lane is
 * automatic. `.screenshot` and `.e2e` stay opt-in: Basis recognizes them for
 * caller attribution, test registration, and snapshot pruning, but Bun will not
 * run them unless a command names their files explicitly.
 */
const TEST_FILE = /\.(test|spec|screenshot|e2e)\.(ts|tsx|js|jsx)$/

/**
 * Whether a file is a Basis test file.
 * @param file - The file path to test.
 * @returns True for a supported test-file suffix.
 */
export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file)
}

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
    /*
     * Bun omits the column at module registration, so a frame may end in
     * `:line` or `:line:column`. Both refer to the same source file.
     */
    const match = line.match(/\(?((?:\/|file:\/\/)[^()\s]+?):\d+(?::\d+)?\)?$/)
    if (!match) continue
    const file = match[1].replace(/^file:\/\//, '')
    if (file.includes('node_modules')) continue
    if (!isTestFile(file)) continue
    return file
  }
  return null
}
