import * as path from 'node:path'

/** One configured static mount. */
export interface StaticMount {
  /** Allowed top-level path entries beneath the mount, or `null` for all. */
  allow: readonly string[] | null,
  /** Absolute folder served by the mount. */
  folder: string,
  /** Normalized mount prefix (leading slash, no trailing slash). */
  prefix: string,
}

/**
 * Normalize a mount prefix to a leading slash with no trailing slash.
 * @param prefix - The configured prefix.
 * @returns The normalized prefix.
 */
export function normalizeMountPrefix(prefix: string): string {
  const collapsed = `/${prefix}`.replace(/\/+/g, '/').replace(/\/+$/, '')
  return collapsed.length === 0 ? '/' : collapsed
}

/**
 * Whether any segment of a path is Basis-owned internal state.
 * @param value - A relative or absolute path.
 * @returns `true` when a `.basis` segment is present.
 */
export function containsInternalStateSegment(value: string): boolean {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'))
  return normalized.split('/').some(segment => segment.toLowerCase() === '.basis')
}

/**
 * Whether a static request targets Basis-owned internal state.
 *
 * `.basis` is never public, regardless of which folder an asset or mount
 * serves. The check rejects traversal and encoded separators as well.
 * @param route - The request path below a static root.
 * @returns `true` when the path must not be served.
 */
export function isInternalStatePath(route: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(route)
  } catch {
    return true
  }

  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'))
  if (
    decoded.includes('\0')
    || path.posix.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    return true
  }

  return containsInternalStateSegment(normalized)
}

/**
 * Serve a file from a static mount when the request path is beneath it.
 *
 * The mount owns traversal protection, allow-list enforcement, content type,
 * and missing-file handling, so callers cannot escape the mounted folder or
 * read a disallowed top-level entry.
 * @param mount - The configured mount.
 * @param requestPath - The decoded request pathname.
 * @returns The file response, or `null` when the path is outside the mount.
 */
export async function serveMount(mount: StaticMount, requestPath: string): Promise<Response | null> {
  if (requestPath !== mount.prefix && !requestPath.startsWith(`${mount.prefix}/`)) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath.slice(mount.prefix.length).replace(/^\/+/, ''))
  } catch {
    return notFound()
  }

  const relative = path.normalize(decoded)
  if (
    decoded.length === 0
    || isInternalStatePath(decoded)
    || decoded.includes('\0')
    || path.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
  ) {
    return notFound()
  }

  if (mount.allow !== null && !mount.allow.some(entry => (
    relative === entry || relative.startsWith(`${entry}/`)
  ))) {
    return notFound()
  }

  const filePath = path.join(mount.folder, relative)
  if (!filePath.startsWith(`${mount.folder}${path.sep}`)) return notFound()
  if (containsInternalStateSegment(mount.folder) || containsInternalStateSegment(filePath)) return notFound()

  const file = Bun.file(filePath)
  if (!(await file.exists())) return notFound()

  return new Response(file, { headers: { 'content-type': file.type } })
}

/**
 * Build the not-found response for a rejected mount request.
 * @returns A `404` response.
 */
function notFound(): Response {
  return new Response('Not found', { status: 404 })
}
