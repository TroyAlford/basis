import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import type { VFile } from 'vfile'
import type { MarkdownConfig } from './index'
import { createMarkdownConfig } from './index'

/** File extensions the Markdown linter owns. */
export const MARKDOWN_EXTENSIONS = ['.md', '.mdx']

/** Directory names the walk never descends into. */
export const IGNORED_DIRECTORIES = [
  '.cache',
  '.git',
  '.playwright-local',
  'build',
  'coverage',
  'dist',
  'docs-dist',
  'node_modules',
  'test-results',
  'tmp',
]

/** A Markdown/MDX lint finding. */
export interface MarkdownIssue {
  /** 1-based column of the finding. */
  column: number,
  /** Path relative to the lint root. */
  file: string,
  /** 1-based line of the finding. */
  line: number,
  /** Human-readable description. */
  message: string,
  /** Rule id, without its source. */
  ruleId: string | null,
  /** Rule source, for example `basis` or `remark-lint`. */
  source: string | null,
}

/** The result of linting a Markdown tree. */
export interface MarkdownReport {
  /** Files rewritten by a fix pass. */
  changed: number,
  /** Documents discovered. */
  files: number,
  /** Findings; empty means the tree is clean. */
  issues: MarkdownIssue[],
}

/** Options accepted by {@link lintMarkdown}. */
export interface MarkdownLintOptions {
  /** Configuration to apply; defaults to the Basis configuration. */
  config?: MarkdownConfig,
  /** Rewrite files in place with the fixed output. */
  fix?: boolean,
  /** Extra directory names to skip, on top of {@link IGNORED_DIRECTORIES}. */
  ignore?: string[],
  /** Directory to lint; defaults to the current working directory. */
  root?: string,
}

/**
 * Whether a path is a Markdown/MDX document.
 * @param path - Path to test.
 * @returns Whether the path ends in a supported extension.
 */
const isDocument = (path: string): boolean => MARKDOWN_EXTENSIONS.includes(extname(path).toLowerCase())

/**
 * Recursively collect Markdown/MDX documents under a directory.
 * @param directory - Absolute directory to walk.
 * @param ignored - Directory names to skip.
 * @returns Absolute document paths, sorted for stable output.
 */
const collect = (directory: string, ignored: Set<string>): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }) as Dirent[]) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) found.push(...collect(path, ignored))
    } else if (entry.isFile() && isDocument(path)) {
      found.push(path)
    }
  }
  return found.sort()
}

/**
 * Build the processor for one document kind.
 * @param config - The resolved configuration.
 * @param mdx - Whether the document is MDX.
 * @returns A unified processor that parses, lints, and serializes.
 */
const processor = (config: MarkdownConfig, mdx: boolean) => {
  const instance = unified().use(remarkParse).use(remarkGfm).use(config.plugins)
  if (mdx) instance.use(remarkMdx)
  return instance.use(remarkStringify, config.settings)
}

/**
 * Map a processed file's messages to reportable issues.
 * @param file - The processed virtual file.
 * @param path - Absolute path of the document.
 * @param root - Absolute lint root.
 * @returns The issues, in message order.
 */
const issuesOf = (file: VFile, path: string, root: string): MarkdownIssue[] => file.messages.map(message => ({
  column: message.column ?? 1,
  file: relative(root, path),
  line: message.line ?? 1,
  message: message.reason,
  ruleId: message.ruleId ?? null,
  source: message.source ?? null,
}))

/**
 * Discover and lint every Markdown/MDX document under a root.
 *
 * With `fix`, each document is serialized back through the configured
 * `remark-stringify` settings and the rules' autofixes, then re-linted so only
 * genuinely residual findings are reported.
 * @param options - Lint options.
 * @returns The report.
 */
export async function lintMarkdown(options: MarkdownLintOptions = {}): Promise<MarkdownReport> {
  const root = resolve(options.root ?? process.cwd())
  const config = options.config ?? createMarkdownConfig()
  const ignored = new Set([...IGNORED_DIRECTORIES, ...(options.ignore ?? [])])
  const files = collect(root, ignored)
  const issues: MarkdownIssue[] = []
  let changed = 0

  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    const mdx = extname(path).toLowerCase() === '.mdx'
    const file = await processor(config, mdx).process(source)

    if (options.fix) {
      const fixed = String(file)
      if (fixed !== source) {
        writeFileSync(path, fixed)
        changed += 1
      }
      issues.push(...issuesOf(await processor(config, mdx).process(fixed), path, root))
    } else {
      issues.push(...issuesOf(file, path, root))
    }
  }

  return { changed, files: files.length, issues }
}

/**
 * Lint the current directory and report the outcome.
 * @param args - CLI arguments; `--fix` rewrites files.
 * @returns Process exit code (`0` when clean).
 */
export async function runMarkdownLint(args: string[]): Promise<number> {
  const fix = args.includes('--fix')
  const report = await lintMarkdown({ fix })

  if (report.files === 0) {
    process.stdout.write('[basis] markdown: no Markdown or MDX files found\n')
    return 0
  }

  for (const issue of report.issues) {
    const rule = issue.ruleId === null ? '' : ` (${issue.source ?? 'basis'}/${issue.ruleId})`
    process.stdout.write(`[basis] markdown: ${issue.file}:${issue.line}:${issue.column} ${issue.message}${rule}\n`)
  }
  if (report.issues.length > 0) {
    process.stdout.write(`[basis] markdown: ${report.issues.length} problem(s) in ${report.files} file(s)\n`)
    return 1
  }

  const summary = fix
    ? `formatted ${report.changed} of ${report.files} file(s)`
    : `ok (${report.files} file(s))`
  process.stdout.write(`[basis] markdown: ${summary}\n`)
  return 0
}
