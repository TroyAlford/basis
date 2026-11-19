import { Mermaid } from 'basis/docs/mermaid'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { existsSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'

const repoRoot = join(import.meta.dir, '..', '..')
const basisLink = join(repoRoot, 'node_modules', 'basis')
if (!existsSync(basisLink)) symlinkSync(repoRoot, basisLink, 'dir')

/**
 * Build one temporary browser application and return its JavaScript output.
 * @param source - The entry module source.
 * @returns The concatenated output JavaScript.
 */
async function build(source: string): Promise<string> {
  const directory = tempDirectory('basis-mermaid-build-')
  symlinkSync(join(repoRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
  const entry = join(directory, 'entry.tsx')
  writeFileSync(entry, source)

  const result = await Bun.build({
    define: { 'process.env.NODE_ENV': '"production"' },
    entrypoints: [entry],
    minify: true,
    outdir: join(directory, 'out'),
    packages: 'bundle',
    target: 'browser',
  })
  if (!result.success) {
    throw new Error(result.logs.map(log => log.message).join('\n'))
  }

  return (await Promise.all(
    result.outputs
      .filter(output => output.path.endsWith('.js'))
      .map(output => readFile(output.path, 'utf8')),
  )).join('\n')
}

describe('Mermaid isolation', () => {
  test('a barrel-only application excludes the Mermaid layout dependencies', async () => {
    const bundle = await build(`
import { Component } from 'basis/react'
import * as React from 'react'

class App extends Component {
  content() { return <div>hello</div> }
}

console.log(App, React)
`)

    expect(bundle).toContain('basis:global')
    expect(bundle).not.toContain('beautiful-mermaid')
    expect(bundle).not.toContain('elkjs')
    expect(bundle).not.toContain('elk')
    expect(bundle).not.toContain('ELK')
  })

  test('the docs Mermaid entrypoint includes its layout dependencies', async () => {
    const bundle = await build(`
import { Mermaid } from 'basis/docs/mermaid'

console.log(Mermaid)
`)

    expect(bundle).toMatch(/elk|ELK/)
    expect(bundle.length).toBeGreaterThan(1_000_000)
  })

  test('Mermaid remains server-renderable from the docs entrypoint', () => {
    const html = renderToString(
      React.createElement(Mermaid, null, 'flowchart TD\n  A[Start] --> B[Ship]'),
    )

    expect(html).toContain('<svg')
    expect(html).toContain('diagram')
  })
})
