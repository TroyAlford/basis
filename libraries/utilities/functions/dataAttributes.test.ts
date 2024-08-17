import { describe, expect,test } from 'bun:test'
import { dataAttributes } from './dataAttributes'

describe('dataAttributes', () => {
  test('kebab-cases names', () => {
    expect(dataAttributes({ 'fooBar': true })).toEqual({ 'data-foo-bar': true })
    expect(dataAttributes({ 'foo-bar': true })).toEqual({ 'data-foo-bar': true })
    expect(dataAttributes({ 'foo_bar': true })).toEqual({ 'data-foo-bar': true })
  })

  test('handles empty input', () => {
    expect(dataAttributes()).toEqual({})
    expect(dataAttributes({})).toEqual({})
  })

  test('handles existing data-* attributes', () => {
    expect(dataAttributes({ 'data-foo': true })).toEqual({ 'data-foo': true })
    expect(dataAttributes({ 'data-foo-bar': true })).toEqual({ 'data-foo-bar': true })
    expect(dataAttributes({ dataFooBar: true })).toEqual({ 'data-foo-bar': true })
  })

  test('handles functions', () => {
    expect(dataAttributes({ 'foo': () => true })).toEqual({ 'data-foo': true })
    expect(dataAttributes({ 'foo': () => 'bar' })).toEqual({ 'data-foo': 'bar' })
    expect(dataAttributes({ 'foo': () => 42 })).toEqual({ 'data-foo': 42 })
  })
})
