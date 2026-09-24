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
