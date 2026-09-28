/*
 * Documentation-site fixture for application-level snapshot tests.
 *
 * The docs site is a Bun HTML entry (`bun ./libraries/docs/index.html`), so the
 * fixture serves it with Bun's native HTML bundler rather than Basis Server.
 * `HOST`/`PORT` are injected by `startApplication`; `/health` is the readiness
 * probe and `/*` falls back to the bundle for client-side routes.
 */
import index from '../../libraries/docs/index.html'

Bun.serve({
  development: process.env.NODE_ENV !== 'production',
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  routes: {
    '/*': index,
    '/health': () => new Response('ok'),
  },
})
