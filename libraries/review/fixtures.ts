import type { ReviewFixture } from './types'

/**
 * Labelled examples for the reference `dead-code` reviewer.
 *
 * These are declarative expectations, not executable tests: a consumer's
 * evaluator runs the reviewer against each diff and compares the adjudicated
 * disposition. Basis deliberately ships no model runtime.
 */
export const STANDARD_REVIEW_FIXTURES: readonly ReviewFixture[] = [
  {
    category: 'remove',
    description: 'A new export that nothing imports and that encodes a private helper.',
    diff: [
      'diff --git a/src/format.ts b/src/format.ts',
      '--- a/src/format.ts',
      '+++ b/src/format.ts',
      '@@ -1 +1,2 @@',
      ' export const used = 1',
      '+export const unusedHelper = (): string => "unused"',
    ].join('\n'),
    expectation: 'finding',
    id: 'dead-code/positive-remove',
    reviewerId: 'dead-code',
  },
  {
    category: 'false-positive',
    description: 'An export discovered dynamically through a registry key.',
    diff: [
      'diff --git a/src/plugins.ts b/src/plugins.ts',
      '--- a/src/plugins.ts',
      '+++ b/src/plugins.ts',
      '@@ -1 +1,2 @@',
      ' export const registry: Record<string, unknown> = {}',
      '+export const loader = (): void => {}',
    ].join('\n'),
    expectation: 'no_finding',
    id: 'dead-code/negative-dynamic',
    reviewerId: 'dead-code',
  },
  {
    category: 'clarify-intent',
    description: 'Half-wired code whose intended correction depends on author intent.',
    diff: [
      'diff --git a/src/feature.ts b/src/feature.ts',
      '--- a/src/feature.ts',
      '+++ b/src/feature.ts',
      '@@ -1 +1,2 @@',
      ' export const flag = true',
      '+export const buildReport = (): string => ""',
    ].join('\n'),
    expectation: 'question',
    id: 'dead-code/question-half-wired',
    reviewerId: 'dead-code',
  },
  {
    category: 'abstain',
    description: 'A dependency finding with no diff context to decide whether it is used.',
    diff: [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -5,0 +6,1 @@',
      '+    "left-pad": "^1.3.0",',
    ].join('\n'),
    expectation: 'abstain',
    id: 'dead-code/abstain-no-context',
    reviewerId: 'dead-code',
  },
]
