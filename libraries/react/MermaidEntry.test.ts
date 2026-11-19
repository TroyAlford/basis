import * as ReactSurface from 'basis/react'
import { Mermaid } from 'basis/react/mermaid'
import { describe, expect, test } from 'bun:test'

describe('Mermaid entrypoint', () => {
  test('is not part of the main react barrel', () => {
    expect('Mermaid' in ReactSurface).toBe(false)
  })

  test('remains available from its opt-in entrypoint', () => {
    expect(typeof Mermaid).toBe('function')
  })
})
