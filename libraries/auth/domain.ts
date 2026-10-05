/**
 * Registrable-domain derivation for cookie scoping.
 *
 * A cookie shared across subdomains needs the registrable (parent) domain:
 * `cc.troyalford.com` and `admin.troyalford.com` both share `troyalford.com`.
 * This derives that parent from a request `Host` value without pulling in a
 * public-suffix dependency, using one documented rule — the last two labels.
 */

/**
 * Whether a hostname is a dotted-decimal IPv4 literal.
 * @param host - The hostname to test.
 * @returns True when it is an IPv4 literal.
 */
const isIPv4 = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host)

/**
 * Normalize a `Host` header value to a lowercase hostname: strip a trailing
 * port and unwrap a bracketed IPv6 literal.
 * @param raw - The `Host` value, or `null`.
 * @returns The hostname, or an empty string.
 */
function hostnameOf(raw: string | null): string {
  const value = (raw ?? '').trim().toLowerCase()
  if (value.length === 0) return ''
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(1, end)
  }
  const colon = value.indexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

/**
 * Derive the registrable domain from a request host.
 *
 * The rule is deliberately simple and explicitly documented:
 *
 * - `localhost` and any `*.localhost`, with or without a port, become
 *   `localhost`, so local development still shares across `foo.localhost` and
 *   `bar.localhost`.
 * - IPv4 literals are returned unchanged, because no suffix is registrable.
 * - Any other name returns its last two dot-separated labels:
 *   `cc.troyalford.com` → `troyalford.com`, `troyalford.com` → `troyalford.com`.
 * - A blank or missing host returns an empty string, which callers treat as
 *   "leave the cookie host-only".
 *
 * The last-two-labels rule does not consult the public suffix list, so
 * `example.co.uk` yields `co.uk`. Deployments under a multi-label public suffix
 * pass the explicit domain to `setIdentityCookie` instead.
 * @param host - A request `Host` header value, or `null`.
 * @returns The lowercased registrable domain, or an empty string.
 */
export function registrableDomain(host: string | null): string {
  const hostname = hostnameOf(host)
  if (hostname.length === 0) return ''
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'localhost'
  if (isIPv4(hostname)) return hostname
  const labels = hostname.split('.')
  return labels.length <= 2 ? hostname : labels.slice(-2).join('.')
}
