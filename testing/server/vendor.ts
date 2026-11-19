import { Server } from 'basis/server'

new Server()
  .root(Bun.env.APP_ROOT ?? import.meta.dir)
  .start({
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 0),
  })
