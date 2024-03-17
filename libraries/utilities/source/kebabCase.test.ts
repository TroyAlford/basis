import { expect, test } from 'bun:test'

import { kebabCase } from './kebabCase'

test('kebabCase', () => {
	expect(kebabCase('foo')).toBe('foo')
	expect(kebabCase('helloWorld')).toBe('hello-world')
	expect(kebabCase('123')).toBe('123')
	expect(kebabCase('diacriticals-éà')).toBe('diacriticals-ea')
	expect(kebabCase('punctuation!marks')).toBe('punctuation-marks')
	expect(kebabCase('acronymsABC')).toBe('acronyms-abc')
	expect(kebabCase('multiple words')).toBe('multiple-words')
	expect(kebabCase('multiple   spaces')).toBe('multiple-spaces')
	expect(kebabCase('non-standard   space   characters')).toBe('non-standard-space-characters')
	expect(kebabCase('UPPERCASE')).toBe('uppercase')
	expect(kebabCase('CamelCase')).toBe('camel-case')
	expect(kebabCase('snake_case')).toBe('snake-case')
	expect(kebabCase('kebab-case')).toBe('kebab-case')
})
