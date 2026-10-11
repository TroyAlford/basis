import { TriangleRight } from 'basis/react/icons'
import { Server } from 'basis/server'
import { join } from 'node:path'

/*
 * Favicon/icon fixture. Spawned as a child process like the managed runtime.
 * `ROOT` overrides the app root (for discovery tests); `ENTRY` overrides the
 * entrypoint; `FAVICON=icon` configures an IconBase favicon.
 */
const root = Bun.env.ROOT ?? import.meta.dir

const server = new Server()
  .root(root)
  .main(Bun.env.ENTRY ?? join(import.meta.dir, '..', 'server', 'Application.tsx'))
  .icons({ Custom: TriangleRight })

if (Bun.env.FAVICON === 'icon') {
  server.favicon(TriangleRight, {
    color: Bun.env.COLOR ?? '000000',
    filled: Bun.env.FILLED === 'true',
  })
}

server.start({
  development: Bun.env.MODE !== 'production',
  hostname: Bun.env.HOST ?? '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  version: Bun.env.VERSION ?? 'development',
})
