import { describe, expect, test } from 'bun:test'
import { runEmit } from './cli'

describe('runEmit', () => {
  test('does not rewrite generated output for a report-only run', async () => {
    const formats: boolean[] = []

    const code = await runEmit(false, {
      emit: async () => ({ emitters: ['typescript'], outputRoot: '/tmp/generated' }),
      format: async fix => {
        formats.push(fix)
        return 0
      },
    })

    expect(code).toBe(0)
    expect(formats).toEqual([])
  })

  test('formats generated output when explicitly requested', async () => {
    const formats: boolean[] = []

    const code = await runEmit(true, {
      emit: async () => ({ emitters: ['typescript'], outputRoot: '/tmp/generated' }),
      format: async fix => {
        formats.push(fix)
        return 0
      },
    })

    expect(code).toBe(0)
    expect(formats).toEqual([true])
  })
})
