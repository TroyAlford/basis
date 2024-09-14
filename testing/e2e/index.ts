import { Server } from '@basis/server'

const server = new Server()
  .root(__dirname)
  .assets('./assets')
  .main('./main.tsx')

server.start()
