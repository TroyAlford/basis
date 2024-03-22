import * as path from 'node:path'
import { Server } from '@basis/server'
import { HttpVerb } from '@basis/utilities'
import { ping } from './apis/ping'

const server = new Server()
	.assets(path.join(__dirname, './assets'))
	.api([HttpVerb.Get], 'ping', ping)

server.start()