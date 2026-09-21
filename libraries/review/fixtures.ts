import { DEAD_CODE_REVIEWER_ID, PLACEHOLDER_DOCUMENTATION_REVIEWER_ID, TOOLING_CONFORMANCE_CHURN_REVIEWER_ID, WARNING_BASELINE_REGRESSION_REVIEWER_ID } from './ids'
import type { ReviewFixture } from './types'

/**
 * Labelled positive/negative examples for the standard reviewers.
 *
 * These are declarative expectations, not executable tests: a consumer's
 * evaluator runs the reviewer against each diff and compares the adjudicated
 * outcome. Basis deliberately ships no model runtime.
 */
export const STANDARD_REVIEW_FIXTURES: readonly ReviewFixture[] = [
  {
    category: 'placeholder-added',
    description: 'A tags-only doc block added only to satisfy a JSDoc rule.',
    diff: [
      'diff --git a/src/thing.ts b/src/thing.ts',
      '--- a/src/thing.ts',
      '+++ b/src/thing.ts',
      '@@ -1 +1,5 @@',
      '+/**',
      '+ * @param deps',
      '+ */',
      '+export const thing = (deps: string): string => deps',
    ].join('\n'),
    expectation: 'finding',
    id: 'placeholder-documentation/positive',
    reviewerId: PLACEHOLDER_DOCUMENTATION_REVIEWER_ID,
  },
  {
    description: 'A newly added doc block that states something non-obvious.',
    diff: [
      'diff --git a/src/thing.ts b/src/thing.ts',
      '--- a/src/thing.ts',
      '+++ b/src/thing.ts',
      '@@ -1 +1,4 @@',
      '+/**',
      '+ * Trims empty segments before joining a display label.',
      '+ */',
      '+export const label = (parts: string[]): string => parts.join(", ")',
    ].join('\n'),
    expectation: 'no_finding',
    id: 'placeholder-documentation/negative',
    reviewerId: PLACEHOLDER_DOCUMENTATION_REVIEWER_ID,
  },
  {
    category: 'baseline-regression',
    description: 'A new broad suppression and a documented new warning baseline.',
    diff: [
      'diff --git a/src/legacy.ts b/src/legacy.ts',
      '--- a/src/legacy.ts',
      '+++ b/src/legacy.ts',
      '@@ -1 +1,4 @@',
      '+// New warnings are expected in this package; keep them as warnings.',
      '+// eslint-disable-next-line no-console',
      '+console.log("debug")',
    ].join('\n'),
    expectation: 'finding',
    id: 'warning-baseline-regression/positive',
    reviewerId: WARNING_BASELINE_REGRESSION_REVIEWER_ID,
  },
  {
    description: 'An unrelated change that leaves the warning baseline untouched.',
    diff: [
      'diff --git a/src/util.ts b/src/util.ts',
      '--- a/src/util.ts',
      '+++ b/src/util.ts',
      '@@ -1 +1,2 @@',
      ' export const one = 1',
      '+export const two = 2',
    ].join('\n'),
    expectation: 'no_finding',
    id: 'warning-baseline-regression/negative',
    reviewerId: WARNING_BASELINE_REGRESSION_REVIEWER_ID,
  },
  {
    category: 'conformance-churn',
    description: 'A narrow lint bump that also rewrites unrelated control flow.',
    diff: [
      'diff --git a/src/parse.ts b/src/parse.ts',
      '--- a/src/parse.ts',
      '+++ b/src/parse.ts',
      '@@ -1,4 +1,4 @@',
      '-export const parse = (v: string) => {',
      '-  if (!v) return null',
      '-  return v.trim()',
      '-}',
      '+export const parse = (v: string): string | null => (v ? v.trim() : null)',
    ].join('\n'),
    expectation: 'finding',
    id: 'tooling-conformance-churn/positive',
    reviewerId: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
  },
  {
    description: 'Import reordering required by the adopted lint standard.',
    diff: [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,2 @@',
      "-import { b } from './b'",
      "-import { a } from './a'",
      "+import { a } from './a'",
      "+import { b } from './b'",
    ].join('\n'),
    expectation: 'no_finding',
    id: 'tooling-conformance-churn/negative',
    reviewerId: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
  },
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
    reviewerId: DEAD_CODE_REVIEWER_ID,
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
    reviewerId: DEAD_CODE_REVIEWER_ID,
  },
  {
    category: 'abstain',
    description: 'A half-implemented feature where intent cannot be established.',
    diff: [
      'diff --git a/src/feature.ts b/src/feature.ts',
      '--- a/src/feature.ts',
      '+++ b/src/feature.ts',
      '@@ -1 +1,2 @@',
      ' export const flag = true',
      '+export const buildReport = (): string => ""',
    ].join('\n'),
    expectation: 'abstain',
    id: 'dead-code/abstain',
    reviewerId: DEAD_CODE_REVIEWER_ID,
  },
]
