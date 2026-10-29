import { tempDirectory } from 'basis/testing'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Options for a fixture lint run. */
export interface BunLintOptions {
  /** The fixture source. */
  code: string,
  /** The fixture path relative to the fixture root. */
  filename?: string,
  /** Whether to apply autofixes. */
  fix?: boolean,
  /** The fixture root. Defaults to a run-scoped directory under `tmp/`. */
  root?: string,
  /** The exported rule name. */
  ruleExport: string,
  /** The rule id. */
  ruleName: string,
  /** Absolute path to the rule module. */
  rulePath: string,
}

/** The observable outcome of a fixture lint run. */
export interface BunLintResult {
  /** Whether the fixture changed. */
  fixed: boolean,
  /** The fixture source after the run. */
  output: string,
  /** The linter's combined output. */
  report: string,
}

/**
 * Lints a fixture through Bun's built-in linter.
 * @param options - The fixture, rule, and run options.
 * @returns The fixture output and the linter report.
 */
export const lintWithBun = (options: BunLintOptions): BunLintResult => {
  const {
    code,
    filename = 'fixture.ts',
    fix = false,
    ruleExport,
    ruleName,
    rulePath,
  } = options
  const root = options.root ?? tempDirectory('bun-lint', join(process.cwd(), 'tmp'))
  const fixture = join(root, filename)
  const config = join(root, 'eslint.config.mjs')
  const extension = filename.slice(filename.lastIndexOf('.') + 1)

  if (!existsSync(join(root, 'package.json'))) {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }))
  }
  mkdirSync(dirname(fixture), { recursive: true })
  writeFileSync(fixture, code)
  writeFileSync(config, [
    `import { ${ruleExport} } from '${rulePath}'`,
    '',
    'export default [{',
    `  files: ['**/*.${extension}'],`,
    '  languageOptions: {',
    "    parser: '@typescript-eslint/parser',",
    '    parserOptions: { ecmaFeatures: { jsx: true } },',
    '  },',
    '  plugins: {',
    '    test: {',
    `      rules: { '${ruleName}': ${ruleExport} },`,
    '    },',
    '  },',
    `  rules: { 'test/${ruleName}': 'error' },`,
    '}]',
    '',
  ].join('\n'))

  const result = Bun.spawnSync({
    cmd: [process.execPath, 'lint', '--config', config, ...(fix ? ['--fix'] : []), fixture],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const output = readFileSync(fixture, 'utf8')

  return {
    fixed: output !== code,
    output,
    report: `${result.stdout.toString()}${result.stderr.toString()}`,
  }
}
