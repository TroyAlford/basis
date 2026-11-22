import index from './index.html'

// eslint-disable-next-line @basis/no-custom-test-server -- Standalone Bun HTML production diagnostic.
Bun.serve({
  development: false,
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  routes: {
    '/': index,
    '/api/health': () => new Response('ok'),
  },
})
