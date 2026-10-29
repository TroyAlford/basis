import { join } from 'node:path'
import { Server } from './consumer/server'

new Server()
  .root(join(import.meta.dir, 'libraries/docs'))
  .main('./App.tsx')
  .start()
