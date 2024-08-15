import { beforeEach } from 'bun:test'

import('@happy-dom/global-registrator')
	.then(({ GlobalRegistrator }) => GlobalRegistrator.register())

beforeEach(() => {
	// reset NODE_ENV
	process.env.NODE_ENV = 'test'
	Bun.env.NODE_ENV = 'test'

	// reset global window
	global.window = new Window() as Window & typeof globalThis
	global.document = global.window.document
	global.fetch = global.window.fetch
	Object.defineProperty(global.window, 'location', {
		get: () => new URL('https://example.com'),
	})
})