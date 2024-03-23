import * as path from 'node:path'
import { Server } from '@basis/server'

const server = new Server()
	.assets(path.join(__dirname, './assets'))

server.start()