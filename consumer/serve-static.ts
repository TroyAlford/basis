/**
 * The bundler plugin a consuming app's `bunfig.toml` must reference so Bun's
 * development server can compile Basis's modules and refresh class components.
 */
export const SERVE_STATIC_PLUGIN = 'basis/serve'

/** Comment markers that fence the block Basis owns, so updates stay idempotent. */
const START_MARKER = '# >>> basis:development-server >>>'
const END_MARKER = '# <<< basis:development-server <<<'

/** The fenced block Basis writes into a consumer's `bunfig.toml`. */
const BLOCK = [
  START_MARKER,
  '[serve.static]',
  `plugins = [${JSON.stringify(SERVE_STATIC_PLUGIN)}]`,
  END_MARKER,
  '',
].join('\n')

/** The result of ensuring the development-server plugin is configured. */
export interface ServeStaticConfig {
  /** Whether the document changed and must be written back. */
  changed: boolean,
  /** The resulting TOML document. */
  text: string,
}

/**
 * Ensure a consuming app's `bunfig.toml` registers the Basis development-server
 * plugin, in a fenced, Basis-owned block.
 *
 * Re-running replaces the fenced block instead of appending, so the edit is
 * idempotent and never disturbs the consumer's own comments or formatting. A
 * document that already mentions the plugin outside the fence is left alone.
 * @param existing - The current `bunfig.toml` contents, or an empty string.
 * @returns The (possibly unchanged) document and whether it changed.
 */
export function ensureServeStaticConfig(existing: string): ServeStaticConfig {
  const current = existing.trim().length === 0 ? '' : `${existing.trimEnd()}\n`

  const start = current.indexOf(START_MARKER)
  const end = current.indexOf(END_MARKER)

  if ((start === -1) !== (end === -1)) {
    throw new Error(`bunfig.toml has one ${START_MARKER} marker without its ${END_MARKER} pair`)
  }

  if (start !== -1 && end !== -1) {
    const afterEnd = current[end + END_MARKER.length] === '\n' ? end + END_MARKER.length + 1 : end + END_MARKER.length
    const text = `${current.slice(0, start)}${BLOCK}${current.slice(afterEnd)}`
    return validate(text, text !== current)
  }

  if (current.includes(SERVE_STATIC_PLUGIN)) return { changed: false, text: current }

  const separator = current.length === 0 ? '' : '\n'
  return validate(`${current}${separator}${BLOCK}`, true)
}

/**
 * Prove an edited document still parses before it is offered for writing.
 * @param text - The edited TOML document.
 * @param changed - Whether the edit differs from the input.
 * @returns The validated result.
 */
function validate(text: string, changed: boolean): ServeStaticConfig {
  Bun.TOML.parse(text)
  return { changed, text }
}
