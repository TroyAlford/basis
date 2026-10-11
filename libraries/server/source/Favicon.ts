import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as BasisIcons from '../../react/icons'
import { IconBase } from '../../react/icons/IconBase/IconBase'

/** Extensions probed for an auto-discovered favicon, in order. */
export const FAVICON_EXTENSIONS = ['ico', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] as const

/** Content types for the favicon extensions Basis serves. */
const CONTENT_TYPES: Record<string, string> = {
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

/** A query of icon options: strings from a URL, or typed values from configuration. */
export type IconOptions = Record<string, boolean | number | string | undefined>

/** A constructable {@link IconBase} subclass, as `IconBase.isIcon` narrows to. */
export type IconClass = new (...args: unknown[]) => IconBase

/** Additional icons an app registers for `/icons/{Name}.svg`, by name. */
export type IconRegistry = Record<string, IconClass>

/** The path segment prefix and suffix for the icon route. */
const ICON_PREFIX = '/icons/'
const ICON_SUFFIX = '.svg'

/**
 * Match `/icons/{Name}.svg`, returning the icon name.
 * @param pathname - The request pathname.
 * @returns The icon name, or `null` when the path is not an icon request.
 */
export function matchIconPath(pathname: string): string | null {
  if (!pathname.startsWith(ICON_PREFIX) || !pathname.endsWith(ICON_SUFFIX)) return null
  const name = pathname.slice(ICON_PREFIX.length, -ICON_SUFFIX.length)
  return name.length > 0 && !name.includes('/') ? name : null
}

/** What `.favicon(...)` accepts: a path, a file/blob, or an {@link IconBase} class. */
export type FaviconInput = Blob | IconClass | string

/** A favicon resolved to what the server should serve and link. */
export type ResolvedFavicon =
  | { blob?: Blob, file?: string, href: string, kind: 'file', path: string, type: string }
  | { href: string, icon: IconClass, kind: 'icon', options: IconOptions, path: string, type: string }
  | { href: string, kind: 'link', path: string, type: string }

/**
 * The content type for a favicon extension.
 * @param extension - The file extension, without a dot.
 * @returns The content type.
 */
export function faviconContentType(extension: string): string {
  return CONTENT_TYPES[extension.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Find a `favicon.<ext>` in the working directory, then the app root.
 *
 * The working directory wins outright: a project-level favicon is preferred
 * over the app's own, and every extension is probed before moving on.
 * @param cwd - The consuming project's working directory.
 * @param root - The server's configured root.
 * @returns The discovered favicon, or `null`.
 */
export function discoverFavicon(cwd: string, root: string): { extension: string, path: string } | null {
  for (const directory of [cwd, root]) {
    for (const extension of FAVICON_EXTENSIONS) {
      const candidate = path.join(directory, `favicon.${extension}`)
      if (fs.existsSync(candidate)) return { extension, path: candidate }
    }
  }

  return null
}

/**
 * Look up an icon by name in the app's registry, then Basis's icon set.
 * @param name - The icon name.
 * @param registry - The app-registered icons.
 * @returns The icon class, or `null`.
 */
export function resolveIcon(name: string, registry: IconRegistry): IconClass | null {
  const registered = registry[name]
  if (registered) return registered

  const basis = (BasisIcons as Record<string, unknown>)[name]
  return IconBase.isIcon(basis) ? basis : null
}

/**
 * Build the query string for an icon's favicon href.
 * @param options - The icon options.
 * @returns A leading-`?` query string, or an empty string.
 */
export function iconQueryString(options: IconOptions): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === false) continue
    query.set(key, value === true ? 'true' : String(value))
  }
  const text = query.toString()
  return text.length > 0 ? `?${text}` : ''
}

/**
 * Render a standalone SVG for an icon, resolving the favicon color and size.
 *
 * Mirrors `NerdrageTools/nerdrage`'s icon controller: `color` is a hex value
 * (with or without `#`), `filled` accepts `true`/``/`filled`, `size` defaults to
 * `1em`, and any other key becomes an icon prop except `stroke`.
 * @param icon - The icon class.
 * @param options - The icon options.
 * @returns The standalone SVG markup.
 */
export function renderIcon(icon: IconClass, options: IconOptions): string {
  const { color = '000000', filled, size = '1em', ...rest } = options
  delete rest.stroke
  const isFilled = filled === true || filled === 'true' || filled === '' || filled === 'filled'

  const props: Record<string, unknown> = { filled: isFilled }
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) props[key] = typeof value === 'boolean' ? value : String(value)
  }
  if (props.width === undefined && props.height === undefined) {
    props.width = String(size)
    props.height = String(size)
  }

  const colorValue = String(color).startsWith('#') ? String(color) : `#${String(color)}`
  const sizeValue = String(size)

  return renderToStaticMarkup(createElement(icon as ComponentType<Record<string, unknown>>, props))
    .replaceAll('var(--basis-icon-color, currentColor)', colorValue)
    .replaceAll('var(--basis-icon-size, 1em)', sizeValue)
    .replaceAll('var(--basis-icon-color)', colorValue)
    .replaceAll('var(--basis-icon-size)', sizeValue)
}

/**
 * Resolve the favicon the server should serve and link.
 *
 * An explicit input wins. Otherwise a `favicon.<ext>` found via
 * {@link discoverFavicon} is used; failing that, the link falls back to the
 * conventional `/assets/favicon.svg` an app may already mount.
 * @param input - The configured favicon, or `null` to discover one.
 * @param options - Icon options, when the input is an icon.
 * @param cwd - The consuming project's working directory.
 * @param root - The server's configured root.
 * @returns The resolved favicon.
 */
export function resolveFavicon(
  input: FaviconInput | null,
  options: IconOptions,
  cwd: string,
  root: string,
): ResolvedFavicon {
  if (typeof input === 'function') {
    return {
      href: `/favicon.svg${iconQueryString(options)}`,
      icon: input,
      kind: 'icon',
      options,
      path: '/favicon.svg',
      type: 'image/svg+xml',
    }
  }

  if (typeof input === 'string') {
    const absolute = path.isAbsolute(input) ? input : path.join(root, input)
    const extension = path.extname(absolute).slice(1).toLowerCase() || 'ico'
    return {
      file: absolute,
      href: `/favicon.${extension}`,
      kind: 'file',
      path: `/favicon.${extension}`,
      type: faviconContentType(extension),
    }
  }

  if (input) {
    const name = (input as { name?: string }).name ?? ''
    const extension = path.extname(name).slice(1).toLowerCase() || 'ico'
    return {
      blob: input,
      href: `/favicon.${extension}`,
      kind: 'file',
      path: `/favicon.${extension}`,
      type: faviconContentType(extension),
    }
  }

  const discovered = discoverFavicon(cwd, root)
  if (discovered) {
    return {
      file: discovered.path,
      href: `/favicon.${discovered.extension}`,
      kind: 'file',
      path: `/favicon.${discovered.extension}`,
      type: faviconContentType(discovered.extension),
    }
  }

  return { href: '/assets/favicon.svg', kind: 'link', path: '/assets/favicon.svg', type: 'image/svg+xml' }
}

/**
 * Serve a resolved favicon, when the server owns its bytes.
 * @param favicon - The resolved favicon.
 * @param query - Query overrides, for an icon favicon.
 * @returns The response, or `null` when the favicon is a mounted-link fallback.
 */
export async function faviconResponse(favicon: ResolvedFavicon, query: URLSearchParams): Promise<Response | null> {
  if (favicon.kind === 'link') return null

  if (favicon.kind === 'icon') {
    return iconResponse(favicon.icon, favicon.options, query)
  }

  if (favicon.blob) {
    return new Response(await favicon.blob.arrayBuffer(), { headers: { 'Content-Type': favicon.type } })
  }
  if (!favicon.file) return null

  const file = Bun.file(favicon.file)
  if (!(await file.exists())) return null
  return new Response(await file.arrayBuffer(), { headers: { 'Content-Type': favicon.type } })
}

/**
 * Render an icon as an SVG response, merging configured options with the request query.
 * @param icon - The icon class.
 * @param options - Configured icon options.
 * @param query - Request query overrides.
 * @returns The SVG response.
 */
export function iconResponse(icon: IconClass, options: IconOptions, query: URLSearchParams): Response {
  const merged: IconOptions = { ...options }
  for (const [key, value] of query) merged[key] = value
  return new Response(renderIcon(icon, merged), {
    headers: { 'Content-Type': 'image/svg+xml' },
  })
}
