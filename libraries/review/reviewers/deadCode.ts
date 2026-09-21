import { DEAD_CODE_REVIEWER_ID } from '../ids'
import type { DetectorCategory, ReviewerPolicy } from '../types'

/**
 * Knip categories that represent dead code and therefore feed the dead-code
 * reviewer. Other knip categories (for example `unresolved`, `unlisted`,
 * `cycles`, and `duplicates`) are not dead-code semantics and are routed
 * elsewhere by policy.
 */
export const DEAD_CODE_KNIP_CATEGORIES: readonly DetectorCategory[] = [
  {
    category: 'dependencies',
    description: 'Runtime dependency declared but never imported.',
  },
  {
    category: 'devDependencies',
    description: 'Dev dependency declared but never used.',
  },
  {
    category: 'enumMembers',
    description: 'Enum member that is never referenced.',
  },
  {
    category: 'exports',
    description: 'Module export that is never imported.',
  },
  {
    category: 'files',
    description: 'Source file that is never imported.',
  },
  {
    category: 'namespaceMembers',
    description: 'Namespace member that is never referenced.',
  },
  {
    category: 'nsExports',
    description: 'Export reachable only through a namespace that is unused.',
  },
  {
    category: 'nsTypes',
    description: 'Type export reachable only through a namespace that is unused.',
  },
  {
    category: 'optionalPeerDependencies',
    description: 'Optional peer dependency declared but never used.',
  },
  {
    category: 'types',
    description: 'Type export that is never imported.',
  },
]

/** Standard policy for the diff-scoped dead-code reviewer. */
export const deadCode: ReviewerPolicy = {
  context: [
    'changed-files',
    'changed-lines',
    'detector-finding',
    'direct-callers',
    'enclosing-scope',
    'package-manifest',
    'related-tests',
  ],
  detectors: [
    {
      categories: DEAD_CODE_KNIP_CATEGORIES,
      detector: 'knip',
    },
  ],
  evidence: [
    {
      id: 'finding',
      requirement: 'The detector finding and the changed file or symbol it is attributed to.',
    },
    {
      id: 'usage',
      requirement: 'Evidence of dynamic, reflective, framework, or entrypoint use, when any.',
    },
  ],
  executionProfile: 'detector-then-adjudicate',
  id: DEAD_CODE_REVIEWER_ID,
  instructions: 'Decide why the symbol is unused and the intended correction; never delete on the finding alone.',
  outOfScope: [
    'Dynamic or reflective use that a static analyzer cannot see.',
    'Framework entrypoints and convention files.',
    'Generated code and test-only exports.',
    'Public package entrypoints whose removal would change the public API.',
  ],
  outcomes: [
    {
      category: 'remove',
      description: 'Genuinely dead code that should be removed.',
      destructive: true,
      outcome: 'finding',
    },
    {
      category: 'wire-up',
      description: 'Code that should have been used and needs connecting.',
      destructive: false,
      outcome: 'finding',
    },
    {
      category: 'fix-reference',
      description: 'A missing entrypoint, configuration, or export reference.',
      destructive: false,
      outcome: 'finding',
    },
    {
      category: 'false-positive',
      description: 'Intentional dynamic, framework, or convention use; not dead.',
      destructive: false,
      outcome: 'no_finding',
    },
    {
      category: 'abstain',
      description: 'Intent cannot be established safely from the supplied evidence.',
      destructive: false,
      outcome: 'abstain',
    },
  ],
  question: 'Why is this code unused, and what is the intended correction?',
  threshold: { minimumConfidence: 0.6, severity: 'warning' },
  title: 'Dead code',
  verification: 'Re-run knip at the review ref and confirm the finding is gone.',
}
