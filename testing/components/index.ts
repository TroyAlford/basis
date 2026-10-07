/*
 * Component-stage fixture for the live visual regression test.
 *
 * Renders one mounted component per path (`/await`, `/mermaid`, `/tooltip`)
 * through Bun's native HTML bundler, so state that only exists after mount is
 * capturable. `HOST`/`PORT` are injected by `startApplication`; `/health` is the
 * readiness probe and `/*` falls back to the bundle for client routes.
 */
import index from './index.html'

Bun.serve({
  development: process.env.NODE_ENV !== 'production',
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  routes: {
    '/*': index,
    '/health': () => new Response('ok'),
  },
})
