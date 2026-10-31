import { dirname, isAbsolute, relative, resolve } from 'node:path'

/**
 * Convert a docs-source-relative path to its served route path.
 * @param relativeFile - Source path relative to the docs root.
 * @returns The route path, empty for an index document.
 */
export function routePathFor(relativeFile: string): string {
  const segments = relativeFile.replace(/\.mdx?$/i, '').split(/[\\/]/)
  if (segments[segments.length - 1] === 'index') segments.pop()
  return segments.join('/')
}

/**
 * Resolve a relative Markdown/MDX link to the route the documentation publishes.
 *
 * Live MDX imports and the static build both use this so a canonical source
 * link works in either output. Links outside the docs root are left alone.
 * @param fromFile - Absolute path of the linking document.
 * @param target - Relative link target without an anchor or query.
 * @param docsRoot - Absolute docs root.
 * @param route - Served docs prefix, `/` for the site root.
 * @returns The served href, or null when the target is outside the docs tree.
 */
export function resolveDocsHref(
  fromFile: string,
  target: string,
  docsRoot: string,
  route = '/',
): string | null {
  const resolved = resolve(dirname(fromFile), target)
  const relativeFile = relative(docsRoot, resolved)
  if (relativeFile.startsWith('..') || isAbsolute(relativeFile)) return null

  const path = routePathFor(relativeFile)
  if (path === '') return route === '/' ? '/' : route
  return route === '/' ? `/${path}` : `${route}/${path}`
}
