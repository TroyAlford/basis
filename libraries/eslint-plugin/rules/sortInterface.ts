/**
 * Ported from `eslint-plugin-typescript-sort-keys`
 * (https://github.com/infctr/eslint-plugin-typescript-sort-keys), released
 * under the ISC license. Original author: infctr <infctr@gmail.com>.
 *
 * Only the default Basis behavior is implemented: ascending, case-sensitive,
 * plain lexicographic comparison with index signatures weighted to the front.
 */
import type { TSESTree } from '@typescript-eslint/types'
import { AST_NODE_TYPES, AST_TOKEN_TYPES } from '@typescript-eslint/types'
import type { Rule } from 'eslint'

/** The TS-aware source code surface used by the sorting rules. */
export interface SourceCode {
  /** Comments before a node. */
  getCommentsBefore(node: TSESTree.Node): TSESTree.Comment[],
  /** Source text for a node or comment. */
  getText(node: TSESTree.Node | TSESTree.Comment): string,
  /** The token after a node. */
  getTokenAfter(
    node: TSESTree.Node,
    options?: { filter?: (token: TSESTree.Token) => boolean, includeComments?: boolean },
  ): TSESTree.Token | null,
  /** The token before a node. */
  getTokenBefore(node: TSESTree.Node): TSESTree.Token | null,
  /** The absolute offsets where each line starts. */
  readonly lineStartIndices: readonly number[],
  /** The source text. */
  readonly text: string,
}

/** A fixer that accepts TypeScript ESTree nodes. */
export interface RuleFixer {
  /** Insert text before a node. */
  insertTextBefore(node: TSESTree.Node, text: string): Rule.Fix,
  /** Remove a node or token. */
  remove(node: TSESTree.Node | TSESTree.Token): Rule.Fix,
  /** Remove a range. */
  removeRange(range: TSESTree.Range): Rule.Fix,
}

/** A rule context with the TS-aware source code surface. */
export interface RuleContext extends Omit<Rule.RuleContext, 'report' | 'sourceCode'> {
  /** Report a finding. */
  report(descriptor: {
    data?: Record<string, unknown>,
    fix?: (fixer: RuleFixer) => Rule.Fix | Rule.Fix[],
    loc?: TSESTree.SourceLocation,
    messageId: 'invalidOrder',
    node?: TSESTree.Node,
  }): void,
  /** The TS-aware source code. */
  sourceCode: SourceCode,
}

interface NodePosition {
  final: number,
  initial: number,
}

const nameToIndexSignature = (name: string): string => `[index: ${name}]`

const indexSignaturePattern = `^${nameToIndexSignature('.+')}`

const indexSignatureRegexp = new RegExp(
  indexSignaturePattern.replace('[', '\\[').replace(']', '\\]'),
)

const charCompare = (a: string, b: string): number => {
  if (a < b) return -1
  if (b < a) return 1
  return 0
}

const getWeight = (value: string): number => (indexSignatureRegexp.test(value) ? 100 : 0)

const compare = (a: string | undefined, b: string | undefined): number => {
  if (!a || !b) return 0
  return charCompare(a, b) - getWeight(a) + getWeight(b)
}

const getObjectBody = (
  node: TSESTree.TSEnumDeclaration | TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeLiteral,
): TSESTree.Node[] => {
  switch (node.type) {
    case AST_NODE_TYPES.TSInterfaceDeclaration:
      return node.body.body
    case AST_NODE_TYPES.TSEnumDeclaration:
      return node.body.members
    case AST_NODE_TYPES.TSTypeLiteral:
      return node.members
    default:
      return []
  }
}

const getProperty = (node: TSESTree.Node): TSESTree.Node | undefined => {
  switch (node.type) {
    case AST_NODE_TYPES.TSIndexSignature: {
      const [identifier] = node.parameters as [TSESTree.Identifier]
      return { ...identifier, name: nameToIndexSignature(identifier.name) }
    }
    case AST_NODE_TYPES.TSPropertySignature:
    case AST_NODE_TYPES.TSMethodSignature:
      return node.key
    case AST_NODE_TYPES.TSEnumMember:
      return node.id
    default:
      return undefined
  }
}

const getPropertyName = (node: TSESTree.Node): string | undefined => {
  const property = getProperty(node)
  if (!property) return undefined
  switch (property.type) {
    case AST_NODE_TYPES.Literal:
      return String(property.value)
    case AST_NODE_TYPES.Identifier:
      return property.name
    default:
      return undefined
  }
}

const createNodeSwapper = (context: RuleContext) => {
  const { sourceCode } = context

  const getIndentRange = (node: TSESTree.Node): [number, number] => {
    const prevSibling = sourceCode.getTokenBefore(node)
    const end = node.range[0]
    const start = prevSibling && prevSibling.loc.start.line === node.loc.start.line
      ? prevSibling.range[1] + 1
      : node.range[0] - node.loc.start.column
    return [start, end]
  }

  const getRangeWithIndent = (node: TSESTree.Node): [number, number] => [getIndentRange(node)[0], node.range[1]]

  const getLineRange = (node: TSESTree.Node): TSESTree.Range => {
    const [start] = getRangeWithIndent(node)
    const index = sourceCode.lineStartIndices.findIndex(n => start === n)
    if (index < 0) return node.range
    const lines = 1 + node.loc.end.line - node.loc.start.line
    return [sourceCode.lineStartIndices[index], sourceCode.lineStartIndices[index + lines]]
  }

  const getIndentText = (node: TSESTree.Node): string => sourceCode.text.slice(...getIndentRange(node))

  const getNodePunctuator = (node: TSESTree.Node): TSESTree.Token | undefined => {
    const punctuator = sourceCode.getTokenAfter(node, {
      filter: token => token.type === AST_TOKEN_TYPES.Punctuator && token.value !== ':',
      includeComments: false,
    })
    return punctuator && /^[,;]$/.test(punctuator.value) ? punctuator : undefined
  }

  return (
    fixer: RuleFixer,
    nodePositions: Map<TSESTree.Node, NodePosition>,
    currentNode: TSESTree.Node,
    replaceNode: TSESTree.Node,
  ): Rule.Fix[] => [currentNode, replaceNode].reduce<Rule.Fix[]>((acc, node) => {
    const otherNode = node === currentNode ? replaceNode : currentNode
    const comments = sourceCode.getCommentsBefore(node)
    const nextSibling = sourceCode.getTokenAfter(node)
    const nodePosition = nodePositions.get(node)
    const otherPosition = nodePositions.get(otherNode)
    const isLastReplacingLast = nodePosition?.final === nodePositions.size - 1
      && nodePosition?.final === otherPosition?.initial
    let text = [
      comments.length ? getIndentText(node) : '',
      sourceCode.getText(node),
    ].join('')
    const punctuator = getNodePunctuator(node)
    if (nextSibling && nextSibling === punctuator) acc.push(fixer.remove(nextSibling))
    if (!/[,;]$/.test(text)) text += ','
    if (isLastReplacingLast) text = text.replace(/,$/, '')
    if (comments.length) {
      acc.push(fixer.insertTextBefore(otherNode, comments
        .map(comment => sourceCode.getText(comment))
        .concat('')
        .join('\n')))
    }
    acc.push(
      fixer.insertTextBefore(otherNode, text),
      fixer.remove(node),
      ...comments.map(comment => fixer.removeRange(getLineRange(comment as unknown as TSESTree.Node))),
    )
    return acc
  }, [])
}

// Shared with the string-enum rule. Module-internal; not part of the public API.
export const createReporter = (
  context: RuleContext,
  createReportObject: (node: TSESTree.Node) => { loc: TSESTree.SourceLocation, messageId: 'invalidOrder' },
): ((body: TSESTree.Node[]) => void) => {
  const swapNodes = createNodeSwapper(context)

  return (body: TSESTree.Node[]): void => {
    const sortedBody = body
      .slice(0)
      .sort((a, b) => compare(getPropertyName(a), getPropertyName(b)))
    const nodePositions = new Map<TSESTree.Node, NodePosition>(
      body.map(node => [node, { final: sortedBody.indexOf(node), initial: body.indexOf(node) }]),
    )
    for (let index = 1; index < body.length; index += 1) {
      const prevNode = body[index - 1]
      const currentNode = body[index]
      const prevNodeName = getPropertyName(prevNode)
      const currentNodeName = getPropertyName(currentNode)
      if (compare(prevNodeName, currentNodeName) > 0) {
        const targetPosition = sortedBody.indexOf(currentNode)
        const replaceNode = body[targetPosition]
        const { loc, messageId } = createReportObject(currentNode)
        context.report({
          data: {
            order: 'asc',
            prevName: prevNodeName,
            thisName: currentNodeName,
          },
          fix: fixer => {
            if (currentNode !== replaceNode) {
              return swapNodes(fixer, nodePositions, currentNode, replaceNode)
            }
            return null
          },
          loc,
          messageId,
          node: currentNode,
        })
      }
    }
  }
}

const interfaceInvalidOrder = [
  'Expected interface keys to be in {{ order }}ending order.',
  " '{{ thisName }}' should be before '{{ prevName }}'.",
].join('')

export const sortInterface: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const ruleContext = context as unknown as RuleContext
    const compareNodeListAndReport = createReporter(ruleContext, node => ({
      loc: node.loc,
      messageId: 'invalidOrder',
    }))
    const listener = {
      TSInterfaceDeclaration(node: TSESTree.TSInterfaceDeclaration) {
        compareNodeListAndReport(getObjectBody(node))
      },
      TSTypeLiteral(node: TSESTree.TSTypeLiteral) {
        compareNodeListAndReport(getObjectBody(node))
      },
    }
    return listener as unknown as Rule.RuleListener
  },
  meta: {
    docs: {
      description: 'require interface keys to be sorted',
    },
    fixable: 'code',
    messages: {
      invalidOrder: interfaceInvalidOrder,
    },
    schema: [],
    type: 'suggestion',
  },
}
