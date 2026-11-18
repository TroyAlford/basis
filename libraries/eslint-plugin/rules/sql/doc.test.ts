/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import { concat, group, hardline, indent, join, line, render, softline, text } from './doc'

describe('SqlDoc', () => {
  test('renders text and soft lines deterministically', () => {
    const doc = group(concat(text('SELECT'), indent(concat(line(), text('id')))))
    expect(render(doc)).toBe('SELECT id')
    expect(render(doc)).toBe(render(doc))
  })

  test('breaks a group when it does not fit', () => {
    const doc = group(concat(text('SELECT'), indent(concat(line(), text('a'), text(','), line(), text('b')))))
    expect(render(doc, 10)).toBe('SELECT\n  a,\n  b')
  })

  test('hard lines always break and soft lines flatten to nothing', () => {
    expect(render(group(concat(text('a'), softline(), text('b'))))).toBe('ab')
    expect(render(group(concat(text('a'), line(), text('b'))))).toBe('a b')
    expect(render(concat(text('a'), hardline(), text('b')))).toBe('a\nb')
  })

  test('indentation follows document nesting', () => {
    const doc = concat(
      text('BEGIN'),
      indent(concat(hardline(), text('IF x THEN'), indent(concat(hardline(), text('y;'))))),
      hardline(),
      text('END'),
    )
    expect(render(doc)).toBe('BEGIN\n  IF x THEN\n    y;\nEND')
  })

  test('joins with a separator', () => {
    expect(render(join(text(', '), [text('a'), text('b'), text('c')]))).toBe('a, b, c')
  })

  test('never splits an atomic text token', () => {
    const long = 'a'.repeat(200)
    expect(render(group(concat(text('SELECT '), text(long))), 20)).toBe(`SELECT ${long}`)
  })
})
