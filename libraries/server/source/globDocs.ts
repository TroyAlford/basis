import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { splitFrontMatter } from '../../utilities'

/** A validation problem found in the docs tree. */
export interface DocsIssue {
  /** Repository-relative path to the offending document. */
  file: string,
  /** 1-based line number of the problem. */
  line: number,
  /** Human-readable description. */
  message: string,
}

/** A Markdown/MDX source document discovered under the docs tree. */
export interface DocsDocument {
  /** Body without front-matter. */
  body: string,
  /** Code-fence validation problems. */
  fenceIssues: DocsIssue[],
  /** Front-matter validation problems. */
  frontMatterIssues: DocsIssue[],
  /** Front-matter `title`, when present. */
  frontMatterTitle: string | null,
  /** Link targets found in the document, in order. */
  links: string[],
  /** Route path relative to the docs root, empty for an index document. */
  path: string,
  /** Repository-relative source path. */
  relativeFile: string,
  /** Absolute source path. */
  source: string,
  /** Display title: front-matter title, first heading, or filename. */
  title: string,
}

/** Markdown/MDX extensions the docs tree recognizes. */
export const DOC_EXTENSIONS = ['.md', '.mdx']

/** A YAML-ish front-matter `key: value` pair. */
const FRONT_MATTER_PAIR = /^([A-Za-z0-9_-]+):\s*(.*)$/

/** A level-one Markdown heading. */
const HEADING = /^#\s+(.+)$/m

/** A Markdown code-fence delimiter. */
const FENCE = /^\s*(`{3,}|~{3,})/

/** A Markdown inline link target. */
const INLINE_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/**
 * Whether a path is a recognized documentation source document.
 * @param path - Path to test.
 * @returns Whether the path ends in a docs extension.
 */
function isDocument(path: string): boolean {
  return DOC_EXTENSIONS.includes(extname(path).toLowerCase())
}

/**
 * Recursively collect documentation documents under a directory.
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
 * Convert a docs-relative source path to a route path.
 * @param relativeFile - Source path relative to the docs root.
 * @returns The route path (empty for an index document).
 */
export function routePath(relativeFile: string): string {
  const segments = relativeFile.replace(/\.mdx?$/i, '').split(/[\\/]/)
  if (segments[segments.length - 1] === 'index') segments.pop()
  return segments.join('/')
}

/**
 * Split a document's front-matter from its body and validate the pairs.
 * @param source - Full document text.
 * @param file - Repository-relative path, for issue reporting.
 * @returns The body, the front-matter title, the consumed line count, and any issues.
 */
function parseFrontMatter(source: string, file: string): {
  body: string,
  issues: DocsIssue[],
  lines: number,
  title: string | null,
} {
  const { body, contents, lines } = splitFrontMatter(source)
  if (contents === null) return { body, issues: [], lines, title: null }

  const issues: DocsIssue[] = []
  let title: string | null = null
  contents.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return
    const match = FRONT_MATTER_PAIR.exec(line)
    if (!match) {
      const rendered = JSON.stringify(line)
      issues.push({ file, line: index + 2, message: `front-matter line is not a "key: value" pair: ${rendered}` })
      return
    }
    if (match[1] === 'title') title = match[2].replace(/^["']|["']$/g, '').trim()
  })
  return { body, issues, lines, title }
}

/**
 * Check that Markdown code fences are balanced.
 * @param body - Document body (without front-matter).
 * @param file - Repository-relative path, for issue reporting.
 * @param offset - Line offset of the body within the file.
 * @returns Any fence issues.
 */
function checkFences(body: string, file: string, offset: number): DocsIssue[] {
  const lines = body.split(/\r?\n/)
  let marker: string | null = null
  let opened = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = FENCE.exec(lines[index])
    if (!match) continue
    if (marker === null) {
      marker = match[1][0]
      opened = index + offset + 1
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
 * Derive a display title for a document.
 * @param body - Document body (without front-matter).
 * @param frontMatterTitle - Front-matter title, when present.
 * @param relativeFile - Source path relative to the docs root.
 * @returns The front-matter title, first heading, or a filename fallback.
 */
function titleOf(body: string, frontMatterTitle: string | null, relativeFile: string): string {
  const raw = frontMatterTitle ?? HEADING.exec(body)?.[1]
  if (raw) return raw.replace(/^["']|["']$/g, '').trim()
  const filename = relativeFile.split(/[\\/]/).pop() ?? ''
  const fallback = filename.replace(/\.mdx?$/i, '').replace(/[-_]+/g, ' ')
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

/**
 * Discover and read every document under a docs tree.
 *
 * This is the single source of truth for docs discovery and front-matter
 * parsing: the validator (`basis docs check`) and the static build
 * (`basis docs build`) both consume it, so the tree that is checked is exactly
 * the tree that is published.
 * @param root - Absolute docs root.
 * @returns The documents, ordered by repository-relative path.
 */
export function globDocs(root: string): DocsDocument[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return []

  return collect(root).map(file => {
    const relativeFile = relative(root, file)
    const contents = readFileSync(file, 'utf8')
    const frontMatter = parseFrontMatter(contents, relativeFile)
    return {
      body: frontMatter.body,
      fenceIssues: checkFences(frontMatter.body, relativeFile, frontMatter.lines),
      frontMatterIssues: frontMatter.issues,
      frontMatterTitle: frontMatter.title,
      links: collectLinks(frontMatter.body),
      path: routePath(relativeFile),
      relativeFile,
      source: file,
      title: titleOf(frontMatter.body, frontMatter.title, relativeFile),
    }
  })
}
