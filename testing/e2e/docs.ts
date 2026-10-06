import { join } from 'node:path'
import { Server } from '@basis/server'

new Server()
  .docs({ root: join(import.meta.dir, '..', '..', 'docs'), title: 'Basis' })
  .start()
