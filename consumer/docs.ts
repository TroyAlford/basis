import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DocsIssue } from '../libraries/server/source/globDocs'
import { globDocs } from '../libraries/server/source/globDocs'

/** A validated documentation page. */
export interface DocsPage {
  /** Repository-relative path to the document. */
  file: string,
  /** Link targets found in the document, in order. */
  links: string[],
  /** Front-matter `title`, when present. */
  title: string | null,
}

/** The result of checking a docs tree. */
export interface DocsReport {
  /** Problems found; empty means the tree is valid. */
  issues: DocsIssue[],
  /** Documents discovered, in stable order. */
  pages: DocsPage[],
}

export type { DocsIssue }

/** Link targets that are not repository-relative documents. */
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i

/**
 * Whether a relative link target resolves to a document or directory.
 * @param target - Link target with anchor/query removed.
 * @param fromFile - Absolute path of the linking document.
 * @returns Whether the target resolves.
 */
function resolves(target: string, fromFile: string): boolean {
  const base = resolve(dirname(fromFile), target)
  if (existsSync(base)) return true
  return ['.md', '.mdx'].some(extension => existsSync(`${base}${extension}`))
    || ['.md', '.mdx'].some(extension => existsSync(join(base, `index${extension}`)))
}

/**
 * Discover and validate a `docs/` tree.
 *
 * Checks that the tree has an `index.md(x)`, that every code fence is closed,
 * that front-matter is well-formed, and that repository-relative links resolve.
 * A missing tree is not an error: repositories opt in by creating `docs/`.
 * @param root - Repository root.
 * @param source - Docs directory relative to the root. Defaults to `docs`.
 * @returns The report.
 */
export function checkDocs(root: string, source = 'docs'): DocsReport {
  const base = resolve(root)
  const directory = resolve(base, source)
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return { issues: [], pages: [] }

  const documents = globDocs(directory)
  const issues: DocsIssue[] = []
  const pages: DocsPage[] = []
  const relative = (file: string): string => join(source, file)
  if (!documents.some(document => document.path === '')) {
    issues.push({ file: `${source}/index.md`, line: 1, message: `missing ${source}/index.md(x)` })
  }

  for (const document of documents) {
    issues.push(
      ...document.frontMatterIssues.map(issue => ({ ...issue, file: relative(issue.file) })),
      ...document.fenceIssues.map(issue => ({ ...issue, file: relative(issue.file) })),
    )
    for (const link of document.links) {
      if (EXTERNAL_LINK.test(link)) continue
      const target = link.split('#')[0].split('?')[0]
      if (target === '') continue
      if (!resolves(target, document.source)) {
        issues.push({ file: relative(document.relativeFile), line: 1, message: `link does not resolve: ${link}` })
      }
    }
    pages.push({ file: relative(document.relativeFile), links: document.links, title: document.frontMatterTitle })
  }

  return { issues, pages }
}

/**
 * Resolve the docs source directory for the command.
 * @param root - Repository root.
 * @param args - Arguments after the `docs` subcommand.
 * @returns The configured source directory.
 */
function resolveSource(root: string, args: string[]): string {
  const flag = args.indexOf('--source')
  const flagged = args[flag + 1]
  if (flag !== -1 && flagged !== undefined && !flagged.startsWith('-')) return flagged
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      basis?: { docs?: { source?: string } },
    }
    return manifest.basis?.docs?.source ?? 'docs'
  } catch {
    return 'docs'
  }
}

/**
 * Validate the repository's canonical docs tree and report the outcome.
 * @param args - Arguments after the `docs` subcommand.
 * @returns Process exit code (`0` when valid).
 */
export function runDocs(args: string[]): number {
  const root = process.cwd()
  const source = resolveSource(root, args)
  const report = checkDocs(root, source)

  if (report.pages.length === 0 && report.issues.length === 0) {
    process.stdout.write(`[basis] docs: no ${source}/ directory; nothing to check\n`)
    return 0
  }
  for (const issue of report.issues) {
    process.stdout.write(`[basis] docs: ${issue.file}:${issue.line} ${issue.message}\n`)
  }
  if (report.issues.length > 0) {
    process.stdout.write(`[basis] docs: ${report.issues.length} problem(s) in ${report.pages.length} page(s)\n`)
    return 1
  }
  process.stdout.write(`[basis] docs: ok (${report.pages.length} page(s))\n`)
  return 0
}

/**
 * Build the documentation tree to a static site (for example GitHub Pages).
 * @param args - Arguments after the `docs build` subcommand.
 * @returns Process exit code.
 */
export async function runDocsBuild(args: string[]): Promise<number> {
  const root = process.cwd()
  const source = resolveSource(root, args)
  const value = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag)
    const found = args[index + 1]
    return index !== -1 && found !== undefined && !found.startsWith('-') ? found : fallback
  }
  const out = value('--out', 'docs-dist')
  const base = value('--base', '')
  const title = value('--title', 'Documentation')

  const { buildDocs, discoverDocs } = await import('../libraries/server/source/mdxToHTML')
  const site = discoverDocs({ root: join(root, source), route: '/', title })
  if (site.pages.size === 0 && site.modules.size === 0) {
    process.stdout.write(`[basis] docs: no ${source}/ directory; nothing to build\n`)
    return 0
  }

  const written = await buildDocs(site, resolve(root, out), base)
  process.stdout.write(`[basis] docs: built ${written.length} page(s) to ${out}\n`)
  return 0
}
