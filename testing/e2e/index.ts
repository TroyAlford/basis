import { Server } from '@basis/server'

const server = new Server()
	.root(__dirname)
	.assets('./assets')
	.hydrator('./hydrate.tsx')

server.start()