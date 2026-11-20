import direct from './direct.html'
import documentWrite from './document-write.html'

const vendor = Bun.file(new URL('./public/vendor.js', import.meta.url))

// eslint-disable-next-line @basis/no-custom-test-server -- Measuring Bun HTML script bundling.
Bun.serve({
  hostname: Bun.env.HOST ?? '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  routes: {
    '/api/health': Response.json({ status: 'ok' }),
    '/assets/vendor/vendor.js': new Response(vendor, {
      headers: { 'Content-Type': 'text/javascript' },
    }),
    '/direct': direct,
    '/document-write': documentWrite,
  },
})
