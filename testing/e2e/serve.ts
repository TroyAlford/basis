import { Server } from 'basis/server'

const server = new Server()
  .root(__dirname)
  .assets('./assets')
  .main('./Application.tsx')

server.start()
