import { beforeEach, spyOn } from 'bun:test'

global.FILTERED_WARNINGS = [
	/ReactDOM.render is no longer supported in React 18/,
]

const filter = (message: string) => (
	!global.FILTERED_WARNINGS.some(regex => regex.test(message))
)

beforeEach(() => {
	spyOn(console, 'error').mockImplementation(filter)
	spyOn(console, 'warn').mockImplementation(filter)
	spyOn(console, 'info').mockImplementation(filter)
	spyOn(console, 'log').mockImplementation(filter)
	spyOn(console, 'debug').mockImplementation(filter)
	spyOn(console, 'trace').mockImplementation(filter)
})
