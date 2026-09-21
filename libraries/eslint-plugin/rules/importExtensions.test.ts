import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importExtensions } from './importExtensions'

const CONFIG: Linter.Config = {
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: {
    test: {
      rules: {
        'import-extensions': importExtensions,
      },
    },
  },
  rules: {
    'test/import-extensions': 'error',
  },
}

interface LintOptions {
  cwd?: string,
  filename?: string,
}

const resolveOptions = (options: LintOptions): { cwd: string, filename: string } => ({
  cwd: options.cwd ?? process.cwd(),
  filename: options.filename ?? 'fixture.ts',
})

describe('importExtensions', () => {
  const lint = (code: string, options: LintOptions = {}) => {
    const { cwd, filename } = resolveOptions(options)
    const linter = new Linter({ cwd })
    return linter.verifyAndFix(code, [CONFIG], { filename })
  }

  const verify = (code: string, options: LintOptions = {}) => {
    const { cwd, filename } = resolveOptions(options)
    const linter = new Linter({ cwd })
    return linter.verify(code, [CONFIG], { filename })
  }

  test('allows an extensionless tsx import', () => {
    const output = lint("import { Button } from './Button'", { filename: 'fixture.tsx' })
    expect(output.fixed).toBe(false)
    expect(output.messages).toHaveLength(0)
  })

  test('reports and removes a forbidden ts extension', () => {
    const code = "import { util } from './__missing_module__.ts'"
    const messages = verify(code)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toBe(
      'Unexpected use of file extension "ts" for "./__missing_module__.ts"',
    )

    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe("import { util } from './__missing_module__'")
  })

  test('reports and adds a missing json extension', () => {
    const directory = mkdtempSync(join(tmpdir(), 'basis-import-extensions-'))
    try {
      writeFileSync(join(directory, 'data.json'), '{}\n')
      const code = "import data from './data'"
      const messages = verify(code, { cwd: directory, filename: join(directory, 'fixture.ts') })
      expect(messages).toHaveLength(1)
      expect(messages[0]?.message).toBe('Missing file extension "json" for "./data"')

      const output = lint(code, { cwd: directory, filename: join(directory, 'fixture.ts') })
      expect(output.fixed).toBe(true)
      expect(output.output).toBe("import data from './data.json'")
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  test('leaves an unrelated extension untouched', () => {
    const code = "import './styles.css'"
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('fixes dynamic imports', () => {
    const directory = mkdtempSync(join(tmpdir(), 'basis-import-extensions-'))
    try {
      writeFileSync(join(directory, 'data.json'), '{}\n')
      const output = lint("const data = import('./data')", {
        cwd: directory,
        filename: join(directory, 'fixture.ts'),
      })
      expect(output.fixed).toBe(true)
      expect(output.output).toBe("const data = import('./data.json')")
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
