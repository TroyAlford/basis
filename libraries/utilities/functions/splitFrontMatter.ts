/** The pieces of a document once a leading YAML front-matter block is removed. */
export interface FrontMatterParts {
  /** The document body, with the front-matter block removed. */
  body: string,
  /** The front-matter block contents without the `---` fences, or `null` when absent. */
  contents: string | null,
  /** How many lines the front-matter block occupied, including its fences. */
  lines: number,
}

/** A leading YAML front-matter block. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Split a leading YAML front-matter block from a Markdown/MDX document.
 *
 * This is the repository's single front-matter parser: the documentation
 * validator (which reads `contents` for titles and issues) and the MDX build
 * plugin (which keeps only `body`) share it, so the block that is validated is
 * the block that is compiled.
 * @param source - The raw document.
 * @returns The body, the raw front-matter contents, and the consumed line count.
 */
export function splitFrontMatter(source: string): FrontMatterParts {
  const match = FRONT_MATTER.exec(source)
  if (!match) return { body: source, contents: null, lines: 0 }
  return {
    body: source.slice(match[0].length),
    contents: match[1],
    lines: match[0].split(/\r?\n/).length - 1,
  }
}
