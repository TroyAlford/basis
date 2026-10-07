import { Server } from './consumer/server'

new Server()
  .docs({ root: './docs', route: '/', title: 'Basis' })
  .start()
