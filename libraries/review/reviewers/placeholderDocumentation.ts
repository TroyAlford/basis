import { PLACEHOLDER_DOCUMENTATION_REVIEWER_ID } from '../ids'
import type { ReviewerPolicy } from '../types'

/** Standard policy for documentation added only to satisfy a lint rule. */
export const placeholderDocumentation: ReviewerPolicy = {
  context: ['changed-lines', 'enclosing-scope'],
  detectors: [
    {
      categories: [
        {
          category: 'empty-block',
          description: 'A documentation or comment block added with no descriptive prose.',
        },
        {
          category: 'tags-only-block',
          description: 'A block containing only tags such as @param with no description text.',
        },
      ],
      detector: 'docblock-prose',
    },
  ],
  evidence: [
    {
      id: 'block',
      requirement: 'The exact added block and the symbol it documents.',
    },
    {
      id: 'hunk',
      requirement: 'The diff hunk showing the block did not exist before this change.',
    },
  ],
  executionProfile: 'detector-then-adjudicate',
  id: PLACEHOLDER_DOCUMENTATION_REVIEWER_ID,
  instructions: 'Flag only blocks this change added that carry no descriptive prose of their own.',
  outOfScope: [
    'Pre-existing blocks that this change did not touch.',
    'Generated files and test fixtures.',
    'Blocks whose prose is meaningful even if terse.',
  ],
  outcomes: [
    {
      category: 'placeholder-added',
      description: 'The block is scaffolding added only to satisfy a documentation rule.',
      destructive: false,
      outcome: 'finding',
    },
    {
      category: 'documented',
      description: 'The block states something a reader did not already know from the identifier.',
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
  question: 'Does this change add documentation that has no descriptive prose of its own?',
  threshold: { minimumConfidence: 0.7, severity: 'info' },
  title: 'Placeholder documentation',
  verification: 'Re-run the docblock-prose scan over the changed range.',
}
