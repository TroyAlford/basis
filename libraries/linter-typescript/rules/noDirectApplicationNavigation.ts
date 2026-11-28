/**
 * Bans direct navigation in browser-backed consumer tests.
 *
 * `useApplication` returns the shared application handle. Browser journeys
 * navigate through `app.visit(path, fn)`; there is no second navigation API.
 */

import type { Rule, Scope } from 'eslint'
import type * as ESTree from 'estree'
import { memberProperty, unwrapExpression } from './imports'

const NAVIGATION_METHODS: ReadonlySet<string> = new Set([
  'goBack',
  'goForward',
  'goto',
  'reload',
])

interface NodeLike {
  [key: string]: unknown,
  type?: string,
}

const isObject = (value: unknown): value is NodeLike => (
  typeof value === 'object' && value !== null
)

const nodeType = (node: unknown): string | null => (
  isObject(node) && typeof node.type === 'string' ? node.type : null
)

const literalName = (node: unknown): string | null => {
  if (!isObject(node)) return null
  if (nodeType(node) === 'Identifier' && typeof node.name === 'string') return node.name
  if (nodeType(node) === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

const findVariable = (scope: Scope.Scope, name: string): Scope.Variable | null => {
  let current: Scope.Scope | null = scope
  while (current) {
    const variable = current.set.get(name)
    if (variable) return variable
    current = current.upper
  }
  return null
}

// Read the property key that binds a destructured name.
const patternProperty = (pattern: unknown, name: string): string | null => {
  if (!isObject(pattern) || nodeType(pattern) !== 'ObjectPattern') return null
  const properties = pattern.properties
  if (!Array.isArray(properties)) return null
  for (const property of properties) {
    if (!isObject(property) || nodeType(property) !== 'Property') continue
    const key = literalName(property.key)
    if (key === null) continue
    const value = property.value
    if (isObject(value) && nodeType(value) === 'AssignmentPattern') {
      const left = value.left
      if (isObject(left) && nodeType(left) === 'Identifier' && left.name === name) return key
      continue
    }
    if (isObject(value) && nodeType(value) === 'Identifier' && value.name === name) return key
    const nested = patternProperty(value, name)
    if (nested !== null) return key
  }
  return null
}

// Whether an expression refers to the `page` callback value or an alias of it.
const isPageLike = (
  context: Rule.RuleContext,
  node: unknown,
  seen: Set<Scope.Variable> = new Set(),
): boolean => {
  const expression = unwrapExpression(node)
  if (!isObject(expression) || nodeType(expression) !== 'Identifier') return false
  const name = expression.name
  if (typeof name !== 'string') return false
  if (name === 'page') return true

  const variable = findVariable(
    context.sourceCode.getScope(expression as unknown as ESTree.Node),
    name,
  )
  if (!variable || seen.has(variable)) return false
  seen.add(variable)

  for (const definition of variable.defs) {
    if (definition.type !== 'Variable') continue
    const declarator = definition.node
    if (!isObject(declarator) || declarator.init === null || declarator.init === undefined) continue
    return isPageLike(context, declarator.init, seen)
  }
  return false
}

// Resolve a call target to a navigation method, following page aliases.
const navigationMethod = (context: Rule.RuleContext, callee: unknown): string | null => {
  const expression = unwrapExpression(callee)
  if (!isObject(expression)) return null

  if (nodeType(expression) === 'MemberExpression') {
    const method = memberProperty(expression)
    if (method === null || !NAVIGATION_METHODS.has(method)) return null
    return isPageLike(context, expression.object) ? method : null
  }

  if (nodeType(expression) !== 'Identifier' || typeof expression.name !== 'string') return null
  const name = expression.name
  const variable = findVariable(
    context.sourceCode.getScope(expression as unknown as ESTree.Node),
    name,
  )
  if (!variable) return null

  for (const definition of variable.defs) {
    if (definition.type !== 'Variable') continue
    const declarator = definition.node
    if (!isObject(declarator) || declarator.init === null || declarator.init === undefined) continue
    const init = unwrapExpression(declarator.init)

    if (isObject(init) && nodeType(init) === 'MemberExpression') {
      const method = memberProperty(init)
      if (method !== null && NAVIGATION_METHODS.has(method) && isPageLike(context, init.object)) {
        return method
      }
    }

    const method = patternProperty(declarator.id, name)
    if (method !== null && NAVIGATION_METHODS.has(method) && isPageLike(context, declarator.init)) {
      return method
    }
  }
  return null
}

export const noDirectApplicationNavigation: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: ESTree.CallExpression) {
        const method = navigationMethod(context, node.callee)
        if (method === null) return
        context.report({
          data: { method },
          messageId: 'noDirectApplicationNavigation',
          node,
        })
      },
    }
  },
  meta: {
    docs: {
      description: 'Require application visits instead of direct page navigation in tests.',
    },
    messages: {
      noDirectApplicationNavigation: [
        'Direct application navigation through `{{method}}()` is not allowed.',
        ' Use `useApplication` from `basis/testing` and navigate with `app.visit(path, fn)` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
