import { formatMilliseconds, Milliseconds } from '@basis/utilities'

/**
 * Returns a response with the health information.
 * @returns A health response with details about uptime and the current Bun version.
 */
export const health = (): Response => new Response(JSON.stringify({
  bun: Bun.version,
  uptime: {
    nanoseconds: Bun.nanoseconds(),
    pretty: formatMilliseconds(Bun.nanoseconds() * Milliseconds.PerNanosecond),
  },
}), {
  headers: { 'Content-Type': 'application/json' },
  status: 200,
})
