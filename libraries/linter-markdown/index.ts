import remarkFrontmatter from 'remark-frontmatter'
import remarkLintNoConsecutiveBlankLines from 'remark-lint-no-consecutive-blank-lines'
import remarkLintOrderedListMarkerValue from 'remark-lint-ordered-list-marker-value'
import type { Options as StringifyOptions } from 'remark-stringify'
import type { PluggableList } from 'unified'
import { noParagraphLineBreaks } from './rules/noParagraphLineBreaks'

/**
 * The canonical Markdown serialization the Basis formatter emits, passed to
 * `remark-stringify`. It matches Basis's existing conventions so a format pass
 * only rewrites what a rule or canonical block spacing requires.
 */
export const BASE_SETTINGS: StringifyOptions = {
  bullet: '-',
  emphasis: '*',
  fence: '`',
  listItemIndent: 'one',
  rule: '-',
  ruleRepetition: 3,
  ruleSpaces: false,
  strong: '*',
  tightDefinitions: false,
}

/**
 * The Basis Markdown syntax extensions and lint rules, in applied order.
 *
 * Front-matter is parsed and re-serialized so a format pass preserves document
 * metadata, and GFM and MDX are added by the runner per document kind.
 */
export const BASE_PLUGINS: PluggableList = [
  [remarkFrontmatter, ['yaml']],
  remarkLintNoConsecutiveBlankLines,
  [remarkLintOrderedListMarkerValue, 'ordered'],
  noParagraphLineBreaks,
]

/** A resolved Basis Markdown configuration: its plugins and serialization settings. */
export interface MarkdownConfig {
  /** Plugins applied to every Markdown/MDX document, in order. */
  plugins: PluggableList,
  /** `remark-stringify` settings the formatter serializes with. */
  settings: StringifyOptions,
}

/** Options accepted by {@link createMarkdownConfig}. */
export interface CreateMarkdownConfigOptions {
  /** Extra plugins appended after the Basis policy. */
  plugins?: PluggableList,
  /** Serialization settings merged over the Basis policy. */
  settings?: StringifyOptions,
}

/**
 * Builds the Basis Markdown configuration for a consumer project.
 *
 * The configuration bundles the syntax extensions (front-matter, GFM, and MDX),
 * the Basis rules, and the canonical serialization settings, so consumers do
 * not enumerate them.
 * @param options - Additional plugins and serialization settings.
 * @returns A resolved Markdown configuration.
 */
export const createMarkdownConfig = (options: CreateMarkdownConfigOptions = {}): MarkdownConfig => {
  const { plugins = [], settings = {} } = options
  return {
    plugins: [...BASE_PLUGINS, ...plugins],
    settings: { ...BASE_SETTINGS, ...settings },
  }
}

/** The zero-argument Basis Markdown configuration. */
export const markdownConfig = createMarkdownConfig()
