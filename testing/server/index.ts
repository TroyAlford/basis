import { Server } from '@basis/server'

/*
 * Managed-application fixture. `MODE=production` selects the managed runtime;
 * any other value runs the development workflow. `PORT=0` binds an ephemeral
 * port and the server logs the resolved `listening http://<host>:<port>` line
 * through the Basis Logger for the test harness.
 */

/*
 * Production must never reach a third-party CDN. Fail any such fetch so a
 * stray unpkg access becomes a visible error instead of a silent network call.
 */
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes('unpkg.com')) {
    throw new Error(`unexpected CDN request: ${String(input)}`)
  }
  return realFetch(input, init)
}) as typeof fetch

new Server()
  .root(import.meta.dir)
  .assets('./assets')
  .main(Bun.env.ENTRY ?? './Application.tsx')
  .start({
    development: Bun.env.MODE !== 'production',
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 0),
    version: Bun.env.VERSION ?? 'development',
  })

/*
 * The server logs its own `listening http://<host>:<port>` line on startup
 * through the Basis Logger; the fixture adds nothing.
 */
