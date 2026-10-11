import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as BasisIcons from '../../react/icons'
import { Basis } from '../../react/icons/Basis'
import { IconBase } from '../../react/icons/IconBase/IconBase'

/** The standard, extensionless favicon URL every Basis server serves. */
export const FAVICON_URL = '/assets/favicon'

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

/** What `.favicon(...)` accepts: a path, a file/blob, or an {@link IconBase} class. */
export type FavIconInput = Blob | IconClass | string

/**
 * A favicon the server serves at {@link FAVICON_URL}. The source varies — a
 * file or an icon — but the URL is always the same.
 */
export type ResolvedFavIcon =
  | { blob?: Blob, file?: string, href: string, kind: 'file', path: string, type: string }
  | { href: string, icon: IconClass, kind: 'icon', options: IconOptions, path: string, type: string }

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

/**
 * The content type for a favicon extension.
 * @param extension - The file extension, without a dot.
 * @returns The content type.
 */
export function favIconContentType(extension: string): string {
  return CONTENT_TYPES[extension.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Find a `favicon.<ext>` across the given directories, in order.
 *
 * The working directory wins outright: a project-level favicon is preferred
 * over the app's own, and every extension is probed before moving on.
 * @param cwd - The consuming project's working directory.
 * @param root - The server's configured root.
 * @param extraDirectories - Further directories to probe, such as an assets mount.
 * @returns The discovered favicon, or `null`.
 */
export function discoverFavIcon(
  cwd: string,
  root: string,
  extraDirectories: readonly string[] = [],
): { extension: string, path: string } | null {
  for (const directory of [cwd, root, ...extraDirectories]) {
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
 * Resolve what the server serves at {@link FAVICON_URL}.
 *
 * An explicit input wins. Otherwise a `favicon.<ext>` is discovered across the
 * working directory, the app root, and any extra directories (an assets mount).
 * When nothing is found, the server serves the Basis mark, so every Basis server
 * has a working favicon.
 * @param input - The configured favicon, or `null` to discover one.
 * @param options - Icon options, when the input is an icon.
 * @param cwd - The consuming project's working directory.
 * @param root - The server's configured root.
 * @param extraDirectories - Further directories to probe, such as an assets mount.
 * @returns The resolved favicon.
 */
export function resolveFavIcon(
  input: FavIconInput | null,
  options: IconOptions,
  cwd: string,
  root: string,
  extraDirectories: readonly string[] = [],
): ResolvedFavIcon {
  if (IconBase.isIcon(input)) {
    return {
      href: FAVICON_URL,
      icon: input,
      kind: 'icon',
      options,
      path: FAVICON_URL,
      type: 'image/svg+xml',
    }
  }

  if (typeof input === 'string') {
    const absolute = path.isAbsolute(input) ? input : path.join(root, input)
    return {
      file: absolute,
      href: FAVICON_URL,
      kind: 'file',
      path: FAVICON_URL,
      type: favIconContentType(path.extname(absolute).slice(1) || 'ico'),
    }
  }

  if (input) {
    const name = (input as { name?: string }).name ?? ''
    return {
      blob: input,
      href: FAVICON_URL,
      kind: 'file',
      path: FAVICON_URL,
      type: favIconContentType(path.extname(name).slice(1) || 'ico'),
    }
  }

  const discovered = discoverFavIcon(cwd, root, extraDirectories)
  if (discovered) {
    return {
      file: discovered.path,
      href: FAVICON_URL,
      kind: 'file',
      path: FAVICON_URL,
      type: favIconContentType(discovered.extension),
    }
  }

  return {
    href: FAVICON_URL,
    icon: Basis,
    kind: 'icon',
    options: {},
    path: FAVICON_URL,
    type: 'image/svg+xml',
  }
}

/**
 * Serve a resolved favicon.
 * @param favicon - The resolved favicon.
 * @param query - Query overrides, for an icon favicon.
 * @returns The response, or `null` when the backing file is missing.
 */
export async function favIconResponse(favicon: ResolvedFavIcon, query: URLSearchParams): Promise<Response | null> {
  if (favicon.kind === 'icon') return iconResponse(favicon.icon, favicon.options, query)

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
