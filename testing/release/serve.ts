import { Server } from '../../libraries/server/source/Server'

const delay = Number(Bun.env.READY_DELAY ?? 0)
if (delay > 0) await Bun.sleep(delay)
new Server().root(import.meta.dir).main('./Application.tsx').start({
  hmr: false,
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  version: Bun.env.APP_VERSION ?? 'A',
})
