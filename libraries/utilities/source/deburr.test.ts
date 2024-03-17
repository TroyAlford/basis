import { deburr } from './deburr';
import { test, expect } from 'bun:test'

test('deburr', () => {
	expect(deburr('déjà vu')).toBe('deja vu');
	expect(deburr('día')).toBe('dia')
	expect(deburr('Ḟ')).toBe('F');
})