import { join } from 'node:path'
import { lintWithBun } from './testUtils'

/** The lint-message shape used by the compliance rule tests. */
export interface RuleTestMessage {
  /** The rendered message. */
  message: string,
  /** The rule's message id. */
  messageId: string,
}

/**
 * Lint one fixture with a single Basis compliance rule through Bun's linter.
 * @param ruleName - The rule module/export name.
 * @param code - The fixture source.
 * @param filename - The fixture path used for scoping and reporting.
 * @returns The lint messages.
 */
export const lintRule = (ruleName: string, code: string, filename = 'fixture.ts'): RuleTestMessage[] => {
  const output = lintWithBun({
    code,
    filename,
    ruleExport: ruleName,
    ruleName,
    rulePath: join(import.meta.dir, `${ruleName}.ts`),
  })
  const messages: RuleTestMessage[] = []
  const seen = new Set<string>()

  for (const line of output.report.split('\n')) {
    if (!line.includes(`test/${ruleName}`)) continue
    const match = /^\s*\d+:\d+\s+error\s+(.*?)\s+test\//.exec(line)
    if (match === null) continue
    if (seen.has(match[1])) continue
    seen.add(match[1])
    const messageId = ruleName === 'noCustomTestServer' && match[1].includes('managed database')
      ? 'noCustomTestDatabase'
      : ruleName
    messages.push({ message: match[1], messageId })
  }

  return messages
}
