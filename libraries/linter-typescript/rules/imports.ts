/**
 * Resolves the import or global behind an expression.
 *
 * Compliance rules must follow bindings rather than identifier names: a
 * `spawn` imported from `node:child_process`, a namespace member, a
 * destructured `require`, and a local alias all describe the same API.
 */

import type { Rule, Scope } from 'eslint'
import type * as ESTree from 'estree'

/** Where a resolved reference begins. */
export type ReferenceOrigin =
  | { kind: 'global', name: string }
  | { kind: 'module', source: string }

/** A resolved import or global and the member path applied to it. */
export interface ResolvedReference {
  /** The import source or global root. */
  origin: ReferenceOrigin,
  /** Static member path from the origin. `default` marks a default import. */
  path: string[],
}

// The subset of ESTree nodes these helpers inspect.
interface NodeLike {
  [key: string]: unknown,
  type?: string,
}

/** Globals that participate in compliance policies. */
const TRACKED_GLOBALS: ReadonlySet<string> = new Set([
  'Bun',
  'Deno',
  'globalThis',
  'process',
  'require',
])

// Whether a value is a non-null object.
const isObject = (value: unknown): value is NodeLike => (
  typeof value === 'object' && value !== null
)

// Read a node's string `type`.
const nodeType = (node: unknown): string | null => (
  isObject(node) && typeof node.type === 'string' ? node.type : null
)

// Read a node child by key.
const child = (node: NodeLike, key: string): unknown => node[key]

// Read an identifier or string-literal name.
const literalName = (node: unknown): string | null => {
  if (!isObject(node)) return null
  if (nodeType(node) === 'Identifier' && typeof node.name === 'string') return node.name
  if (nodeType(node) === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

/**
 * Unwrap expression wrappers that do not change the referenced value.
 * @param node The expression to unwrap.
 * @returns The innermost expression.
 */
export const unwrapExpression = (node: unknown): unknown => {
  let current = node
  while (isObject(current)) {
    const type = nodeType(current)
    if (
      type === 'AwaitExpression'
      || type === 'ChainExpression'
      || type === 'ParenthesizedExpression'
      || type === 'TSAsExpression'
      || type === 'TSInstantiationExpression'
      || type === 'TSNonNullExpression'
      || type === 'TSSatisfiesExpression'
      || type === 'TSTypeAssertion'
    ) {
      current = child(current, 'expression')
      continue
    }
    if (type === 'TSConstAssertion') {
      current = child(current, 'expression')
      continue
    }
    break
  }
  return current
}

/**
 * Read a statically known member property name.
 * @param node The member expression.
 * @returns The property name, or `null` when it is dynamic.
 */
export const memberProperty = (node: unknown): string | null => {
  const expression = unwrapExpression(node)
  if (nodeType(expression) !== 'MemberExpression' || !isObject(expression)) return null
  const property = child(expression, 'property')
  if (!isObject(property)) return null
  if (child(expression, 'computed') !== true) return literalName(property)
  return literalName(property)
}

/**
 * Read a literal string or an expression-free template literal.
 * @param node The expression.
 * @returns The static string, or `null`.
 */
export const literalString = (node: unknown): string | null => {
  const expression = unwrapExpression(node)
  if (!isObject(expression)) return null
  if (nodeType(expression) === 'Literal' && typeof child(expression, 'value') === 'string') {
    return child(expression, 'value') as string
  }
  if (nodeType(expression) === 'TemplateLiteral') {
    const expressions = child(expression, 'expressions')
    if (Array.isArray(expressions) && expressions.length === 0) {
      const quasis = child(expression, 'quasis')
      if (!Array.isArray(quasis) || quasis.length !== 1) return null
      const [quasi] = quasis
      if (!isObject(quasi)) return null
      const value = child(quasi, 'value')
      if (!isObject(value)) return null
      return typeof child(value, 'cooked') === 'string' ? child(value, 'cooked') as string : null
    }
  }
  return null
}

/**
 * Normalize an import source for policy matching.
 * @param source The raw module specifier.
 * @returns The source without a `node:` protocol.
 */
export const normalizeSource = (source: string): string => source.replace(/^node:/, '')

/**
 * Resolve a variable through the scope chain.
 * @param scope The scope to begin in.
 * @param name The variable name.
 * @returns The variable, or `null`.
 */
const findVariable = (scope: Scope.Scope, name: string): Scope.Variable | null => {
  let current: Scope.Scope | null = scope
  while (current) {
    const variable = current.set.get(name)
    if (variable) return variable
    current = current.upper
  }
  return null
}

// Read the import binding behind a variable.
const importReference = (variable: Scope.Variable): ResolvedReference | null => {
  for (const definition of variable.defs) {
    if (definition.type !== 'ImportBinding') continue
    const declaration = definition.parent
    if (isObject(declaration) && child(declaration, 'importKind') === 'type') continue
    const source = isObject(declaration) && isObject(child(declaration, 'source'))
      ? literalString(child(declaration, 'source'))
      : null
    if (source === null) continue
    const specifier = definition.node
    if (!isObject(specifier)) continue
    if (child(specifier, 'importKind') === 'type') continue
    const type = nodeType(specifier)
    if (type === 'ImportNamespaceSpecifier') {
      return { origin: { kind: 'module', source }, path: [] }
    }
    if (type === 'ImportDefaultSpecifier') {
      return { origin: { kind: 'module', source }, path: ['default'] }
    }
    if (type === 'ImportSpecifier') {
      const imported = child(specifier, 'imported')
      const name = literalName(imported)
      return name === null ? null : { origin: { kind: 'module', source }, path: [name] }
    }
  }
  return null
}

// Read the static property path that binds a destructured name.
const patternPath = (pattern: unknown, name: string): string[] | null => {
  if (!isObject(pattern)) return null
  const type = nodeType(pattern)
  if (type === 'Identifier') return child(pattern, 'name') === name ? [] : null
  if (type === 'AssignmentPattern') {
    return patternPath(child(pattern, 'left'), name)
  }
  if (type === 'RestElement') return null
  if (type !== 'ObjectPattern') return null
  const properties = child(pattern, 'properties')
  if (!Array.isArray(properties)) return null
  for (const property of properties) {
    if (!isObject(property) || nodeType(property) !== 'Property') continue
    const key = literalName(child(property, 'key'))
    if (key === null) continue
    const nested = patternPath(child(property, 'value'), name)
    if (nested !== null) return [key, ...nested]
  }
  return null
}

// Resolve the initializer behind a variable declarator, including destructuring.
const variableReference = (
  context: Rule.RuleContext,
  variable: Scope.Variable,
  seen: Set<Scope.Variable>,
): ResolvedReference | null => {
  const imported = importReference(variable)
  if (imported) return imported

  for (const definition of variable.defs) {
    if (definition.type !== 'Variable') continue
    const declarator = definition.node
    if (!isObject(declarator)) continue
    const init = child(declarator, 'init')
    if (init === undefined || init === null) continue
    const id = child(declarator, 'id')
    const name = variable.name
    const base = resolveReference(context, init, seen)
    if (!base) continue
    if (nodeType(id) === 'Identifier') return base
    const path = patternPath(id, name)
    if (path === null) continue
    return { origin: base.origin, path: [...base.path, ...path] }
  }
  return null
}

// Resolve a variable by walking through its binding.
const resolveVariable = (
  context: Rule.RuleContext,
  variable: Scope.Variable,
  seen: Set<Scope.Variable>,
): ResolvedReference | null => {
  if (seen.has(variable)) return null
  seen.add(variable)
  return variableReference(context, variable, seen)
}

/**
 * Resolve an expression to its import or global origin.
 * @param context The rule context.
 * @param node The expression to resolve.
 * @param seen Variables already followed, used to stop alias cycles.
 * @returns The resolved reference, or `null`.
 */
export const resolveReference = (
  context: Rule.RuleContext,
  node: unknown,
  seen: Set<Scope.Variable> = new Set(),
): ResolvedReference | null => {
  const expression = unwrapExpression(node)
  if (!isObject(expression)) return null

  const type = nodeType(expression)

  if (type === 'Identifier') {
    const name = child(expression, 'name')
    if (typeof name !== 'string') return null
    const scope = context.sourceCode.getScope(expression as unknown as ESTree.Node)
    const variable = findVariable(scope, name)
    if (variable) return resolveVariable(context, variable, seen)
    return TRACKED_GLOBALS.has(name) ? { origin: { kind: 'global', name }, path: [] } : null
  }

  if (type === 'MemberExpression') {
    const property = memberProperty(expression)
    if (property === null) return null
    const object = resolveReference(context, child(expression, 'object'), seen)
    if (!object) return null
    if (object.origin.kind === 'global' && object.origin.name === 'globalThis' && object.path.length === 0) {
      return { origin: { kind: 'global', name: property }, path: [] }
    }
    return { origin: object.origin, path: [...object.path, property] }
  }

  if (type === 'ImportExpression') {
    const source = literalString(child(expression, 'source'))
    return source === null ? null : { origin: { kind: 'module', source }, path: [] }
  }

  if (type === 'CallExpression') {
    const callee = child(expression, 'callee')
    const target = resolveReference(context, callee, seen)
    const isRequire = target?.origin.kind === 'global'
      && target.origin.name === 'require'
      && target.path.length === 0
    if (!isRequire) return null
    const argumentsList = child(expression, 'arguments')
    if (!Array.isArray(argumentsList)) return null
    const [first] = argumentsList
    const source = literalString(first)
    return source === null ? null : { origin: { kind: 'module', source }, path: [] }
  }

  return null
}

/**
 * Strip a default-import marker from a resolved path.
 * @param reference The resolved reference.
 * @returns The export path relative to the module or global.
 */
export const exportPath = (reference: ResolvedReference): string[] => (
  reference.path[0] === 'default' ? reference.path.slice(1) : reference.path
)

/**
 * Whether a reference starts at one of the given modules.
 * @param reference The resolved reference.
 * @param sources Module sources to match, with or without `node:`.
 * @returns Whether the origin is one of the sources.
 */
export const fromSource = (reference: ResolvedReference, sources: readonly string[]): boolean => {
  if (reference.origin.kind !== 'module') return false
  const source = normalizeSource(reference.origin.source)
  return sources.some(candidate => normalizeSource(candidate) === source)
}

/**
 * Whether a reference starts at one of the given globals.
 * @param reference The resolved reference.
 * @param names Global names to match.
 * @returns Whether the origin is one of the globals.
 */
export const fromGlobal = (reference: ResolvedReference, names: readonly string[]): boolean => (
  reference.origin.kind === 'global' && names.includes(reference.origin.name)
)

/**
 * Whether a resolved reference names an exact export.
 * @param reference The resolved reference.
 * @param sources Module sources to match, with or without `node:`.
 * @param names Export names to match.
 * @returns Whether the reference matches.
 */
export const isExport = (
  reference: ResolvedReference,
  sources: readonly string[],
  names: readonly string[],
): boolean => fromSource(reference, sources) && names.includes(exportPath(reference)[0] ?? '')

/**
 * Collect static string fragments from a value.
 * @param node The expression to inspect.
 * @returns Every statically known string, including array and template fragments.
 */
export const staticStrings = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(entry => staticStrings(entry))
  const expression = unwrapExpression(node)
  if (!isObject(expression)) return []
  const literal = literalString(expression)
  if (literal !== null) return [literal]
  const type = nodeType(expression)
  if (type === 'TemplateLiteral') {
    const quasis = child(expression, 'quasis')
    if (!Array.isArray(quasis)) return []
    return quasis.flatMap(quasi => {
      if (!isObject(quasi)) return []
      const value = child(quasi, 'value')
      return isObject(value) && typeof child(value, 'cooked') === 'string'
        ? [child(value, 'cooked') as string]
        : []
    })
  }
  if (type === 'ArrayExpression') {
    const elements = child(expression, 'elements')
    if (!Array.isArray(elements)) return []
    return elements.flatMap(element => staticStrings(element))
  }
  if (type === 'ObjectExpression') {
    const properties = child(expression, 'properties')
    if (!Array.isArray(properties)) return []
    return properties.flatMap(property => (
      isObject(property) && nodeType(property) === 'Property' ? staticStrings(child(property, 'value')) : []
    ))
  }
  return []
}
