import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'

/** A Markdown or MDX source document discovered under the docs tree. */
export interface DocsPage {
  /** Repository-relative path to the document. */
  file: string,
  /** Link targets found in the document, in order. */
  links: string[],
  /** Front-matter `title`, when present. */
  title: string | null,
}

/** A validation problem found in the docs tree. */
export interface DocsIssue {
  /** Repository-relative path to the offending document. */
  file: string,
  /** 1-based line number of the problem. */
  line: number,
  /** Human-readable description. */
  message: string,
}

/** The result of checking a docs tree. */
export interface DocsReport {
  /** Problems found; empty means the tree is valid. */
  issues: DocsIssue[],
  /** Documents discovered, in stable order. */
  pages: DocsPage[],
}

/** Markdown/MDX extensions the docs tree recognizes. */
const DOCS_EXTENSIONS = ['.md', '.mdx']

/** Link targets that are not repository-relative documents. */
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i

/** A YAML-ish front-matter `key: value` pair. */
const FRONT_MATTER_PAIR = /^([A-Za-z0-9_-]+):\s*(.*)$/

/** A Markdown code-fence delimiter. */
const FENCE = /^\s*(`{3,}|~{3,})/

/** A Markdown inline link target. */
const INLINE_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/**
 * Whether a path is a recognized docs source document.
 * @param path - Path to test.
 * @returns Whether the path ends in a docs extension.
 */
function isDocument(path: string): boolean {
  return DOCS_EXTENSIONS.includes(extname(path).toLowerCase())
}

/**
 * Recursively collect docs source documents under a directory.
 * @param directory - Absolute directory to walk.
 * @returns Absolute document paths, sorted for stable output.
 */
function collect(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }) as Dirent[]) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...collect(path))
    else if (entry.isFile() && isDocument(path)) found.push(path)
  }
  return found.sort()
}

/**
 * Parse YAML-ish front-matter at the top of a document.
 * @param contents - Full document text.
 * @param file - Repository-relative path, for issue reporting.
 * @returns The parsed title and any structural issue.
 */
function parseFrontMatter(contents: string, file: string): { issues: DocsIssue[], title: string | null } {
  const issues: DocsIssue[] = []
  if (!contents.startsWith('---')) return { issues, title: null }

  const lines = contents.split(/\r?\n/)
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') { end = index; break }
  }
  if (end === -1) {
    issues.push({ file, line: 1, message: 'front-matter is not closed with ---' })
    return { issues, title: null }
  }

  let title: string | null = null
  for (let index = 1; index < end; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = FRONT_MATTER_PAIR.exec(line)
    if (!match) {
      const rendered = JSON.stringify(line)
      issues.push({ file, line: index + 1, message: `front-matter line is not a "key: value" pair: ${rendered}` })
      continue
    }
    if (match[1] === 'title') title = match[2].replace(/^["']|["']$/g, '').trim()
  }
  return { issues, title }
}

/**
 * Check that Markdown code fences are balanced.
 * @param contents - Full document text.
 * @param file - Repository-relative path, for issue reporting.
 * @returns Any fence issues.
 */
function checkFences(contents: string, file: string): DocsIssue[] {
  const lines = contents.split(/\r?\n/)
  let marker: string | null = null
  let opened = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = FENCE.exec(lines[index])
    if (!match) continue
    if (marker === null) {
      marker = match[1][0]
      opened = index + 1
    } else if (match[1][0] === marker) {
      marker = null
    }
  }
  return marker === null ? [] : [{ file, line: opened, message: 'code fence is not closed' }]
}

/**
 * Collect Markdown inline link targets from a document.
 * @param contents - Full document text.
 * @returns Raw link targets in document order.
 */
function collectLinks(contents: string): string[] {
  const links: string[] = []
  let match: RegExpExecArray | null
  INLINE_LINK.lastIndex = 0
  while ((match = INLINE_LINK.exec(contents)) !== null) links.push(match[1])
  return links
}

/**
 * Whether a relative link target resolves to a document or directory.
 * @param target - Link target with anchor/query removed.
 * @param fromFile - Absolute path of the linking document.
 * @returns Whether the target resolves.
 */
function resolves(target: string, fromFile: string): boolean {
  const base = resolve(dirname(fromFile), target)
  if (existsSync(base)) return true
  return DOCS_EXTENSIONS.some(extension => existsSync(`${base}${extension}`))
    || DOCS_EXTENSIONS.some(extension => existsSync(join(base, `index${extension}`)))
}

/**
 * Whether a link target is a relative repository document reference.
 * @param link - Raw link target.
 * @returns Whether the target should be validated.
 */
function isRelativeDocumentLink(link: string): boolean {
  return !EXTERNAL_LINK.test(link)
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
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return { issues: [], pages: [] }

  const files = collect(directory)
  const issues: DocsIssue[] = []
  const pages: DocsPage[] = []

  if (!files.some(file => /[/\\]index\.mdx?$/i.test(file))) {
    const message = `missing ${source}/index.md(x)`
    issues.push({ file: `${source}/index.md`, line: 1, message })
  }

  for (const file of files) {
    const relativeFile = relative(base, file)
    const contents = readFileSync(file, 'utf8')
    const frontMatter = parseFrontMatter(contents, relativeFile)
    issues.push(...frontMatter.issues, ...checkFences(contents, relativeFile))

    const links = collectLinks(contents)
    for (const link of links) {
      if (!isRelativeDocumentLink(link)) continue
      const target = link.split('#')[0].split('?')[0]
      if (target === '') continue
      if (!resolves(target, file)) {
        issues.push({ file: relativeFile, line: 1, message: `link does not resolve: ${link}` })
      }
    }

    pages.push({ file: relativeFile, links, title: frontMatter.title })
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

  const { buildDocs, discoverDocs } = await import('../libraries/server/source/Docs')
  const site = discoverDocs({ root: join(root, source), route: '/', title })
  if (site.pages.size === 0 && site.modules.size === 0) {
    process.stdout.write(`[basis] docs: no ${source}/ directory; nothing to build\n`)
    return 0
  }

  const written = await buildDocs(site, resolve(root, out), base)
  process.stdout.write(`[basis] docs: built ${written.length} page(s) to ${out}\n`)
  return 0
}
