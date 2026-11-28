import index from './index.html'

const nativeServe = Bun.serve
// eslint-disable-next-line @basis/no-custom-test-server -- Standalone Bun HTML monkeypatch diagnostic.
Bun.serve = (options => nativeServe({ ...options, development: false })) as typeof Bun.serve

// eslint-disable-next-line @basis/no-custom-test-server -- Standalone Bun HTML monkeypatch diagnostic.
Bun.serve({
  development: false,
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  routes: {
    '/': index,
    '/api/health': () => new Response('ok'),
  },
})
