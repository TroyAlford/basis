/** Generated, dependency, and test-output directories every Basis config ignores. */
export const IGNORE_PATHS = ['node_modules', '.cache', '.playwright-local', 'build', 'dist', 'test-results']

/** Flat-config ignore patterns for {@link IGNORE_PATHS}. */
export const IGNORE_PATTERNS = IGNORE_PATHS.flatMap(path => [`${path}/**`, `**/${path}/**`])
