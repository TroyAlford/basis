import { Mermaid } from 'basis/docs/mermaid'
import * as ReactSurface from 'basis/react'
import { describe, expect, test } from 'bun:test'

describe('Mermaid entrypoint', () => {
  test('is not part of the main react barrel', () => {
    expect('Mermaid' in ReactSurface).toBe(false)
  })

  test('remains available from the docs entrypoint', () => {
    expect(typeof Mermaid).toBe('function')
  })
})
