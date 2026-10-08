/**
 * The bundler plugin a consuming app's `bunfig.toml` must reference so Bun's
 * development server can compile Basis's SASS and Markdown modules.
 */
export const SERVE_STATIC_PLUGIN = 'basis/serve'

/** The `bunfig.toml` section Bun reads development-server plugins from. */
const SECTION = '[serve.static]'

/** Matches the section header on its own line. */
const SECTION_HEADER = /^[ \t]*\[serve\.static\][ \t]*$/m

/** The result of ensuring the development-server plugin is configured. */
export interface ServeStaticConfig {
  /** Whether the document changed and must be written back. */
  changed: boolean,
  /** The resulting TOML document. */
  text: string,
}

/**
 * Ensure a consuming app's `bunfig.toml` registers the Basis development-server
 * plugin.
 *
 * This edits text in place rather than re-serializing parsed TOML, so a
 * consumer's comments and formatting survive. It only handles unambiguous
 * edits: appending a missing section, adding a missing `plugins` key, or
 * extending a single `plugins` array. Anything else (for example a `plugins`
 * value that is not an array) fails loudly instead of guessing.
 * @param existing - The current `bunfig.toml` contents, or an empty string.
 * @returns The (possibly unchanged) document and whether it changed.
 */
export function ensureServeStaticConfig(existing: string): ServeStaticConfig {
  const document = existing.trim().length === 0
    ? ''
    : existing.endsWith('\n') ? existing : `${existing}\n`

  if (document.includes(SERVE_STATIC_PLUGIN)) return { changed: false, text: document }

  const match = SECTION_HEADER.exec(document)

  if (!match) {
    const separator = document.length === 0 || document.endsWith('\n\n') ? '' : '\n'
    const appended = `${document}${separator}${SECTION}\nplugins = [${JSON.stringify(SERVE_STATIC_PLUGIN)}]\n`
    return validate(appended)
  }

  const bodyStart = match.index + match[0].length
  const nextHeader = /^[ \t]*\[/m.exec(document.slice(bodyStart))
  const bodyEnd = nextHeader ? bodyStart + nextHeader.index : document.length
  const body = document.slice(bodyStart, bodyEnd)

  const pluginLine = /^([ \t]*)plugins[ \t]*=[ \t]*\[([^\]]*)\]/m.exec(body)

  if (!pluginLine) {
    if (/^[ \t]*plugins[ \t]*=/m.test(body)) {
      throw new Error(`bunfig.toml ${SECTION} "plugins" must be an array to add "${SERVE_STATIC_PLUGIN}"`)
    }
    const insertion = `\nplugins = [${JSON.stringify(SERVE_STATIC_PLUGIN)}]`
    const updated = `${document.slice(0, bodyStart)}${insertion}${document.slice(bodyStart)}`
    return validate(updated)
  }

  const [whole, indent, entries] = pluginLine
  const existingEntries = entries.trim().replace(/,\s*$/, '')
  const nextEntries = existingEntries.length === 0
    ? JSON.stringify(SERVE_STATIC_PLUGIN)
    : `${existingEntries}, ${JSON.stringify(SERVE_STATIC_PLUGIN)}`
  const lineStart = bodyStart + pluginLine.index
  const replacement = `${indent}plugins = [${nextEntries}]`
  const updated = `${document.slice(0, lineStart)}${replacement}${document.slice(lineStart + whole.length)}`
  return validate(updated)
}

/**
 * Prove an edited document still parses before it is offered for writing.
 * @param text - The edited TOML document.
 * @returns The validated result.
 */
function validate(text: string): ServeStaticConfig {
  Bun.TOML.parse(text)
  return { changed: true, text }
}
