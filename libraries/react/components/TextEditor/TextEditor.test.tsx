import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { TextEditor } from './TextEditor'

describe('TextEditor', () => {
  test('extends FormField with string type', () => {
    const { node } = render(<TextEditor />)
    expect(node).toHaveClass('text-editor', 'component')
  })

  test('handles string values correctly', () => {
    const { node } = render(<TextEditor value="test string" />)
    const input = node.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('test string')
  })

  test('has correct display name', () => {
    expect(TextEditor.displayName).toBe('TextEditor')
  })
})
