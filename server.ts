import { Server } from './consumer/server'
import { routes } from './libraries/docs/routes.ts'

new Server()
  .docs({ pages: routes, root: './docs', route: '/', title: 'Basis' })
  .start()
