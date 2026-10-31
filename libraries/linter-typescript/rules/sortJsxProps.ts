import type { Rule } from 'eslint'
import type { TSESTree } from '../../linter-support'

/** A custom JSX prop group. */
interface CustomGroup {
  /** Pattern matched against the prop name. */
  elementNamePattern: string,
  /** Group to place matching props in. */
  groupName: string,
  /** Optional modifiers; only `multiline` is supported. */
  modifiers?: string[],
}

/** Options accepted by the rule. */
interface SortJsxPropsOptions {
  /** Custom patterns that override the built-in groups. */
  customGroups?: CustomGroup[],
  /** Group order. */
  groups?: string[],
  /** Whether name comparisons ignore case. */
  ignoreCase?: boolean,
}

const DEFAULT_GROUPS = [
  'reserved',
  'shorthand-prop',
  'unknown',
  'multiline-prop',
  'callback',
  'multiline-callback',
]

/**
 * Whether an attribute spans more than one line.
 * @param attribute - The attribute to inspect.
 * @returns Whether it spans multiple lines.
 */
const isMultiline = (attribute: TSESTree.JSXAttribute | TSESTree.JSXSpreadAttribute): boolean => (
  attribute.loc.start.line !== attribute.loc.end.line
)

/**
 * Read an attribute's source name.
 * @param attribute - The attribute to inspect.
 * @param source - The source text.
 * @returns The attribute name, or `...` for a spread.
 */
const attributeName = (
  attribute: TSESTree.JSXAttribute | TSESTree.JSXSpreadAttribute,
  source: string,
): string => {
  if (attribute.type === 'JSXSpreadAttribute') return '...'
  return source.slice(attribute.name.range[0], attribute.name.range[1])
}

/**
 * Resolve an attribute's group.
 * @param attribute - The attribute to classify.
 * @param name - The attribute name.
 * @param options - The rule options.
 * @returns The group name.
 */
const groupFor = (
  attribute: TSESTree.JSXAttribute | TSESTree.JSXSpreadAttribute,
  name: string,
  options: SortJsxPropsOptions,
): string => {
  const multiline = isMultiline(attribute)
  const custom = options.customGroups?.find(group => {
    if (!new RegExp(group.elementNamePattern).test(name)) return false
    return !group.modifiers?.includes('multiline') || multiline
  })
  if (custom) return custom.groupName

  if (attribute.type === 'JSXSpreadAttribute') return 'unknown'
  if (name === 'key' || name === 'ref') return 'reserved'
  if (attribute.value === null) return 'shorthand-prop'

  const callback = /^on[A-Z]/.test(name)
  if (callback) return multiline ? 'multiline-callback' : 'callback'
  return multiline ? 'multiline-prop' : 'unknown'
}

export const sortJsxProps: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as SortJsxPropsOptions
    const groups = options.groups ?? DEFAULT_GROUPS
    const ignoreCase = options.ignoreCase ?? true

    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const attributes = node.attributes
        if (attributes.length < 2) return

        const source = context.sourceCode.text
        const entries = attributes.map((attribute, index) => {
          const name = attributeName(attribute, source)
          const group = groupFor(attribute, name, options)
          return {
            attribute,
            group: groups.indexOf(group) === -1 ? groups.length : groups.indexOf(group),
            index,
            name: ignoreCase ? name.toLowerCase() : name,
          }
        })
        const compare = (
          left: typeof entries[number],
          right: typeof entries[number],
        ): number => (
          left.group - right.group
          || left.name.localeCompare(right.name)
          || left.index - right.index
        )

        const order = entries.map(entry => entry.index)
        let segmentStart = 0
        while (segmentStart < attributes.length) {
          if (attributes[segmentStart].type === 'JSXSpreadAttribute') {
            segmentStart += 1
            continue
          }

          let segmentEnd = segmentStart
          while (segmentEnd < attributes.length && attributes[segmentEnd].type !== 'JSXSpreadAttribute') {
            segmentEnd += 1
          }

          const segment = entries.slice(segmentStart, segmentEnd).sort(compare)
          segment.forEach((entry, offset) => { order[segmentStart + offset] = entry.index })
          segmentStart = segmentEnd
        }

        const firstMismatch = order.findIndex((index, position) => index !== position)
        if (firstMismatch === -1) return
        const sorted = order.map(index => entries[index])

        const first = attributes[0]
        const last = attributes[attributes.length - 1]
        const chunks = attributes.map((attribute, index) => {
          const start = index === 0 ? first.range[0] : attributes[index - 1].range[1]
          return source.slice(start, attribute.range[1])
        })
        const replacement = sorted
          .map(entry => chunks[entry.index])
          .map((chunk, index) => {
            if (index === 0) return chunk.replace(/^\s+/, '')
            return /^\s/.test(chunk) ? chunk : ` ${chunk}`
          })
          .join('')

        context.report({
          fix: fixer => fixer.replaceTextRange([first.range[0], last.range[1]], replacement),
          messageId: 'unsorted',
          node: attributes[order[firstMismatch]],
        })
      },
    } as unknown as Rule.RuleListener
  },
  meta: {
    docs: {
      description: 'require JSX props to be sorted',
    },
    fixable: 'code',
    messages: {
      unsorted: 'JSX props must be sorted',
    },
    schema: [{
      additionalProperties: false,
      properties: {
        customGroups: {
          items: {
            additionalProperties: false,
            properties: {
              elementNamePattern: { type: 'string' },
              groupName: { type: 'string' },
              modifiers: { items: { type: 'string' }, type: 'array' },
            },
            required: ['elementNamePattern', 'groupName'],
            type: 'object',
          },
          type: 'array',
        },
        groups: { items: { type: 'string' }, type: 'array' },
        ignoreCase: { type: 'boolean' },
      },
      type: 'object',
    }],
    type: 'suggestion',
  },
}
