import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { IndexHTML } from '../../react/components/IndexHTML/IndexHTML'

/**
 * The internal path Bun serves the generated development shell from. It is
 * registered as its own route so the shell bypasses Basis's request router,
 * which then proxies it for UI requests.
 */
export const DEV_SHELL_ROUTE = '/__basis_shell'

/** Options for rendering the development shell document. */
export interface DevShellOptions {
  /** Directory the shell document is written to; script sources are relative to it. */
  directory: string,
  /** Absolute entrypoint files to load, in order. */
  entrypoints: readonly string[],
  /** Document title. */
  title: string,
}

/**
 * Derive the deterministic directory a development shell is generated in.
 *
 * The seed is the server root plus its entrypoints, so two servers serving
 * different applications never share (and clobber) a shell document.
 * @param seed - A stable identity for the served application.
 * @returns An absolute directory under the OS temp directory.
 */
export function devShellDirectory(seed: string): string {
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 16)
  return path.join(tmpdir(), 'basis-dev', digest)
}

/**
 * Express an entrypoint as a URL relative to the shell document.
 * @param directory - The directory the shell document is written to.
 * @param entrypoint - The absolute entrypoint path.
 * @returns The relative, POSIX-separated script source.
 */
function scriptSource(directory: string, entrypoint: string): string {
  const relative = path.relative(directory, entrypoint).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * Render the development shell document.
 *
 * Bun only enables HMR for HTML routes it bundles itself, so development serves
 * a generated document through an HTML route and lets Bun own the module graph,
 * hot updates, and React Fast Refresh. The document is {@link IndexHTML} — the
 * same shell production renders — loaded with module script sources instead of
 * served entrypoint names, so the two shells cannot drift.
 * @param options - The entrypoints, shell directory, and document title.
 * @param options.directory - Directory the shell is written to.
 * @param options.entrypoints - Absolute entrypoint files to load, in order.
 * @param options.title - Document title.
 * @returns The shell HTML.
 */
export function renderDevShell({ directory, entrypoints, title }: DevShellOptions): string {
  const scripts = entrypoints.map(entrypoint => ({ module: true, src: scriptSource(directory, entrypoint) }))
  const body = renderToString(React.createElement(IndexHTML, { favicon: false, scripts, title }))
  return `<!doctype html>\n${body}\n`
}

/**
 * Write the development shell document for the given entrypoints.
 * @param options - The entrypoints, shell directory, and document title.
 * @param options.directory - Directory the shell is written to.
 * @param options.entrypoints - Absolute entrypoint files to load, in order.
 * @param options.title - Document title.
 * @returns The absolute path to the written `index.html`.
 */
export function writeDevShell(options: DevShellOptions): string {
  fs.mkdirSync(options.directory, { recursive: true })
  const file = path.join(options.directory, 'index.html')
  fs.writeFileSync(file, renderDevShell(options))
  return file
}
