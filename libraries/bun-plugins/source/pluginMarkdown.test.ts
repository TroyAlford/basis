import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginMarkdown } from './pluginMarkdown'

describe('pluginMarkdown', () => {
  test('rewrites source document links to live site routes', async () => {
    const root = tempDirectory('basis-markdown-plugin-')
    const docs = join(root, 'docs')
    mkdirSync(docs)

    try {
      writeFileSync(join(docs, 'index.mdx'), '# Home\n\n[Install](./installation.mdx)\n')
      writeFileSync(join(docs, 'installation.mdx'), '# Installation\n')

      const result = await Bun.build({
        entrypoints: [join(docs, 'index.mdx')],
        external: ['react/jsx-runtime'],
        plugins: [pluginMarkdown({ docsRoot: docs })],
        target: 'bun',
      })

      expect(result.success).toBe(true)
      const code = await result.outputs[0].text()
      expect(code).toContain('"/installation"')
      expect(code).not.toContain('./installation.mdx')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('injects the docs Mermaid component for Mermaid fences', async () => {
    const root = tempDirectory('basis-markdown-mermaid-')
    const docs = join(root, 'docs')
    mkdirSync(docs)

    try {
      writeFileSync(
        join(docs, 'diagram.mdx'),
        '# Diagram\n\n```mermaid\nflowchart TD\n  A[Start] --> B[Ship]\n```\n',
      )

      const result = await Bun.build({
        entrypoints: [join(docs, 'diagram.mdx')],
        external: ['basis/docs/mermaid', 'react/jsx-runtime'],
        plugins: [pluginMarkdown({ docsRoot: docs })],
        target: 'bun',
      })

      expect(result.success).toBe(true)
      const code = await result.outputs[0].text()
      expect(code).toContain('basis/docs/mermaid')
      expect(code).toContain('Mermaid')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
