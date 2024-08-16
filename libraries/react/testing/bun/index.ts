import { expect } from 'bun:test'
import { toHaveAttribute } from './matchers/toHaveAttribute'
import { toHaveClass } from './matchers/toHaveClass'

import './extensions/console'

expect.extend({
	toHaveAttribute,
	toHaveClass,
})
