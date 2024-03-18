import { expect } from 'bun:test'
import { toHaveAttribute } from './matchers/toHaveAttribute'
import './extensions/console'

expect.extend({
	toHaveAttribute,
})
