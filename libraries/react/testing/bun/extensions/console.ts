import { afterEach, beforeEach, spyOn } from 'bun:test'

global.FILTERED_WARNINGS = [
  /ReactDOM.render is no longer supported in React 18/,
]

const originalConsole = { ...console }

const logIfNotFiltered = (
  type: 'error' | 'warn' | 'info' | 'log' | 'debug' | 'trace',
  messages: unknown[],
) => {
  if (global.FILTERED_WARNINGS.some(regex => regex.test(messages.map(String).join('')))) return
  originalConsole[type](messages)
}

beforeEach(() => {
  spyOn(console, 'error').mockImplementation((...messages) => logIfNotFiltered('error', messages))
  spyOn(console, 'warn').mockImplementation((...messages) => logIfNotFiltered('warn', messages))
  spyOn(console, 'info').mockImplementation((...messages) => logIfNotFiltered('info', messages))
  spyOn(console, 'log').mockImplementation((...messages) => logIfNotFiltered('log', messages))
  spyOn(console, 'debug').mockImplementation((...messages) => logIfNotFiltered('debug', messages))
  spyOn(console, 'trace').mockImplementation((...messages) => logIfNotFiltered('trace', messages))
})

afterEach(() => {
  spyOn(console, 'error').mockRestore()
  spyOn(console, 'warn').mockRestore()
  spyOn(console, 'info').mockRestore()
  spyOn(console, 'log').mockRestore()
  spyOn(console, 'debug').mockRestore()
  spyOn(console, 'trace').mockRestore()
})
