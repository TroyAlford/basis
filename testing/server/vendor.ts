import { Server } from 'basis/server'

const vendor = Bun.env.VENDOR_ROOT
if (!vendor) throw new Error('VENDOR_ROOT is required')

new Server()
  .root(import.meta.dir)
  .vendor(vendor)
  .start({
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 0),
  })
