import { describe, expect, test } from 'bun:test'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { noParagraphLineBreaks } from './noParagraphLineBreaks'

/**
 * Lints Markdown with the Basis paragraph rule.
 * @param value - Markdown source.
 * @returns The reported messages and the serialized output.
 */
const lint = async (value: string) => {
  const processor = unified()
    .use(remarkParse)
    .use(noParagraphLineBreaks)
    .use(remarkStringify, { bullet: '-' })
  const file = await processor.process(value)
  return { messages: file.messages, output: String(file) }
}

describe('basis/no-paragraph-line-breaks', () => {
  test('reports a soft-wrapped paragraph', async () => {
    const { messages } = await lint('A paragraph that\nwraps across lines.\n')

    expect(messages).toHaveLength(1)
    expect(messages[0]?.ruleId).toBe('no-paragraph-line-breaks')
    expect(messages[0]?.source).toBe('basis')
  })

  test('joins a soft-wrapped paragraph when fixing', async () => {
    const { output } = await lint('A paragraph that\nwraps across lines.\n')

    expect(output).toBe('A paragraph that wraps across lines.\n')
  })

  test('accepts a single-line paragraph', async () => {
    const { messages } = await lint('A single-line paragraph.\n')

    expect(messages).toHaveLength(0)
  })

  test('leaves a hard break intact', async () => {
    const { messages, output } = await lint('Line one  \nLine two.\n')

    expect(messages).toHaveLength(0)
    expect(output).toContain('Line two.')
  })

  test('joins a paragraph inside a list item', async () => {
    const { output } = await lint('- an item that\n  wraps here\n')

    expect(output).toBe('- an item that wraps here\n')
  })
})
