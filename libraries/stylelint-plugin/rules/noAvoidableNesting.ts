import type { ChildNode, Container, Root, Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import stylelint from 'stylelint'
import postcss from 'postcss'

const { createPlugin, utils: { report, ruleMessages, validateOptions } } = stylelint

/** The Stylelint rule name. */
export const ruleName = 'basis/no-avoidable-nesting'

const messages = ruleMessages(ruleName, {
  rejected: 'Stylesheet is not in canonical ownership form. Nesting must express ' +
    'a branch or carry declarations; run Stylelint with --fix to normalize it.',
})

const meta = {
  fixable: true,
  url: 'https://github.com/TroyAlford/basis/blob/main/libraries/stylelint-plugin/README.md',
}

/** Any `${...}` interpolation in a selector or raw segment. */
const INTERPOLATION = /\$\{/

/**
 * Whether a node can root an ownership segment (an element, class, id, or `*`).
 * @param node - A selector node.
 * @returns True when the node is a simple selector that can own a block.
 */
const isBase = (node: selectorParser.Node): boolean => (
  node.type === 'tag'
  || node.type === 'class'
  || node.type === 'id'
  || node.type === 'universal'
)

/**
 * Whether a node is a state, pseudo, or attribute attachment on a compound.
 * @param node - A selector node.
 * @returns True when the node narrows its compound.
 */
const isAttachment = (node: selectorParser.Node): boolean => (
  node.type === 'pseudo' || node.type === 'attribute'
)

/**
 * Render selector nodes back to source text, trimming surrounding whitespace.
 * @param nodes - The selector nodes to render.
 * @returns The rendered selector text.
 */
const render = (nodes: selectorParser.Node[]): string => (
  nodes.map(node => node.toString()).join('').trim()
)

/** The first ownership segment of a selector item, and the remainder nested beneath it. */
interface Unit {
  /** The nested selector after the owner, or an empty string when the owner is terminal. */
  remainder: string,
  /** The leading owner segment, e.g. `.header` or `> .actions`. */
  unit: string,
}

/**
 * Split one selector item into its leading owner segment and the remainder.
 *
 * Returns null when the item is anchored to the current scope (`&:hover`) or is a
 * reverse selector (`.theme &`, `[disabled] &`), because those are relative to the
 * owner rather than new owners to lift.
 * @param nodes - The nodes of one selector item.
 * @returns The leading unit and remainder, or null when the item cannot be split.
 */
const splitUnit = (nodes: selectorParser.Node[]): Unit | null => {
  if (nodes.some(node => node.type === 'nesting')) return null

  let index = 0
  const unitNodes: selectorParser.Node[] = []
  const [head] = nodes

  if (head?.type === 'combinator') {
    unitNodes.push(head)
    index = 1
  }

  while (index < nodes.length) {
    const node = nodes[index]
    if (!node || !isBase(node)) break

    unitNodes.push(node)
    index += 1
  }

  if (unitNodes.length === 0 || (unitNodes.length === 1 && head?.type === 'combinator')) {
    while (index < nodes.length) {
      const node = nodes[index]
      if (!node || node.type === 'combinator') break

      unitNodes.push(node)
      index += 1
    }
  }

  const unit = render(unitNodes)
  if (!unit) return null

  const remainderNodes = nodes.slice(index)
  const [firstRemainder] = remainderNodes
  let remainder = render(remainderNodes)
  if (firstRemainder && isAttachment(firstRemainder)) remainder = `&${remainder}`

  return { remainder, unit }
}

/**
 * Parse a selector into its selector-list items, or null when it cannot be
 * understood (interpolated or malformed).
 * @param selector - The raw selector text.
 * @returns The parsed selector items, or null.
 */
const parseSelectorItems = (selector: string): selectorParser.Selector[] | null => {
  if (INTERPOLATION.test(selector)) return null

  try {
    return selectorParser().astSync(selector).nodes
  } catch {
    return null
  }
}

/**
 * Replace top-level `${...}` interpolations with class-shaped placeholders so
 * the surrounding selector structure can still be analyzed.
 * @param selector - The raw selector text.
 * @returns The sanitized text plus the extracted interpolation sources.
 */
const sanitizeInterpolations = (selector: string): { text: string, values: string[] } => {
  const values: string[] = []
  let text = ''
  let index = 0

  while (index < selector.length) {
    const char = selector[index]

    if (char === '$' && selector[index + 1] === '{') {
      let depth = 1
      let end = index + 2

      while (end < selector.length && depth > 0) {
        if (selector[end] === '{') depth += 1
        else if (selector[end] === '}') depth -= 1
        end += 1
      }

      values.push(selector.slice(index, end))
      text += `.I${values.length - 1}`
      index = end
    } else {
      text += char
      index += 1
    }
  }

  return { text, values }
}

/**
 * Whether a selector is a single selector (not a list) even when it contains a
 * `${...}` interpolation.
 * @param selector - The raw selector text.
 * @returns True when the selector holds exactly one selector item.
 */
const isSingleSelectorText = (selector: string): boolean => {
  const { text } = sanitizeInterpolations(selector)

  try {
    return selectorParser().astSync(text).nodes.length === 1
  } catch {
    return false
  }
}

/**
 * The owner selectors of a rule, or null when they cannot be determined. Falls
 * back to the raw selector when it contains interpolations but is a single
 * selector, so interpolated owners still flatten.
 * @param selector - The raw selector text.
 * @returns The owner selector strings, or null.
 */
const ownerStrings = (selector: string): string[] | null => {
  const items = parseSelectorItems(selector)
  if (items) return items.map(item => item.toString())

  return isSingleSelectorText(selector) ? [selector] : null
}

/**
 * The leading owner segment of a single-selector rule, or null when the rule is
 * a selector list, anchored to the scope, reverse, or otherwise unsplittable.
 * @param selector - The raw selector text.
 * @returns The rule's unit and remainder, or null.
 */
const unitOf = (selector: string): Unit | null => {
  const items = parseSelectorItems(selector)
  if (!items || items.length !== 1) return null

  const [item] = items
  return item ? splitUnit(item.nodes) : null
}

/**
 * Split every item of a selector list into a unit when they are all factorable.
 * @param items - The parsed selector-list items.
 * @returns The units, or null when any item cannot be split or is terminal.
 */
const unitsOfList = (items: selectorParser.Selector[]): Unit[] | null => {
  const units: Unit[] = []

  for (const item of items) {
    const unit = splitUnit(item.nodes)
    if (!unit || !unit.unit || !unit.remainder) return null

    units.push(unit)
  }

  return units
}

/**
 * Resolve a nested selector against its owner, following CSS nesting semantics:
 * `&` is replaced by the owner, otherwise the nested selector is a descendant.
 * @param owner - The owning selector.
 * @param nested - The nested selector.
 * @returns The resolved selector.
 */
const resolve = (owner: string, nested: string): string => (
  nested.includes('&') ? nested.replace(/&/g, owner) : `${owner} ${nested}`.trim()
)

/**
 * Whether a selector is the canonical top-level component root
 * (`.{kebab-case-name}.component`), which is a protected, non-compressible anchor.
 * @param selector - The raw selector text.
 * @returns True when the selector is a component root.
 */
const isComponentRoot = (selector: string): boolean => {
  const items = parseSelectorItems(selector)
  if (!items || items.length !== 1) return false

  const [item] = items
  if (!item) return false

  const { nodes } = item
  if (nodes.some(node => node.type === 'combinator' || node.type === 'nesting')) return false

  const classes = nodes.filter(node => node.type === 'class')
  return classes.at(-1)?.value === 'component'
}

/**
 * Every direct child rule of a container.
 * @param container - The parent container.
 * @returns The direct child rules.
 */
const childRules = (container: Container): Rule[] => (
  (container.nodes ?? []).filter((node): node is Rule => node.type === 'rule')
)

/**
 * The indentation of a node, taken from the last line of its `before` raw.
 * @param before - The node's `raws.before` text.
 * @returns The leading whitespace of the node's line.
 */
const indentOf = (before: unknown): string => {
  const text = typeof before === 'string' ? before : ''
  return /\n([ \t]*)$/.exec(text)?.[1] ?? ''
}

/**
 * Whether any `${...}` interpolation lives directly in this container's raws.
 * @param container - The container whose child raws to inspect.
 * @returns True when an interpolation is present.
 */
const hasInterpolation = (container: Container): boolean => (
  (container.nodes ?? []).some(node => (
    Object.values(node.raws ?? {}).some(value => (
      typeof value === 'string' && INTERPOLATION.test(value)
    ))
  ))
)

/**
 * Re-indent a container's children so moved nodes print cleanly: each child on
 * its own line, two spaces deeper than its container.
 * @param container - The container to re-indent.
 * @param indent - The indentation of the container itself.
 */
const reindent = (container: Container, indent: string): void => {
  if (container.type === 'rule') container.raws.between = ' '

  for (const child of container.nodes ?? []) {
    child.raws.before = `\n${indent}  `
    if (child.type === 'rule' || child.type === 'atrule') reindent(child as Container, `${indent}  `)
  }

  if (container.type !== 'root') container.raws.after = `\n${indent}`
}

/**
 * Flatten every unary, declaration-less child rule into its single child,
 * concatenating the selectors. Protected component roots are left intact.
 * @param container - The scope to normalize.
 * @returns True when at least one rule was flattened.
 */
const flatten = (container: Container): boolean => {
  let changed = false

  for (const rule of childRules(container)) {
    if (rule.parent !== container) continue
    if (container.type === 'root' && isComponentRoot(rule.selector)) continue

    const nodes = rule.nodes ?? []
    if (nodes.length !== 1) continue

    const [child] = nodes
    if (!child || child.type !== 'rule') continue

    const owners = ownerStrings(rule.selector)
    const nested = parseSelectorItems(child.selector)
    if (!owners || !nested || nested.length > 1) continue

    const merged = owners.flatMap(owner => (
      nested.map(inner => resolve(owner, inner.toString()))
    ))

    rule.selector = merged.join(', ')
    for (const node of [...(child.nodes ?? [])]) rule.append(node)
    child.remove()
    if (rule.last?.type === 'decl') rule.raws.semicolon = true
    reindent(rule, indentOf(rule.raws.before))
    changed = true
  }

  return changed
}

/**
 * Factor a repeated owner shared by sibling rules into its own branch node.
 * @param container - The scope to normalize.
 * @returns True when at least one group was factored.
 */
const factorSiblings = (container: Container): boolean => {
  const groups = new Map<string, Rule[]>()

  for (const rule of childRules(container)) {
    const unit = unitOf(rule.selector)
    if (!unit) continue

    const group = groups.get(unit.unit) ?? []
    group.push(rule)
    groups.set(unit.unit, group)
  }

  let changed = false

  for (const [unit, group] of groups) {
    if (group.length < 2) continue

    const [first] = group
    if (!first) continue

    const parent = postcss.rule({ selector: unit })
    parent.raws.before = first.raws.before
    /*
     * Synthesized nodes must carry the source of the rule they factor out:
     * Stylelint re-lints the fixed tree, and rules that contextualize nodes by
     * source (e.g. no-duplicate-selectors, stylelint-order) throw without it.
     */
    parent.source = first.source
    container.insertBefore(first, parent)

    for (const rule of group) {
      const info = unitOf(rule.selector)
      if (!info) continue

      if (info.remainder) {
        rule.selector = info.remainder
        parent.append(rule)
      } else {
        for (const node of [...(rule.nodes ?? [])]) parent.append(node)
        rule.remove()
      }
    }

    if (parent.last?.type === 'decl') parent.raws.semicolon = true
    reindent(parent, indentOf(parent.raws.before))
    changed = true
  }

  return changed
}

/**
 * Factor a shared owner out of a selector list
 * (`p:first-child, p:last-child` -> `p { &:first-child, &:last-child }`).
 * @param container - The scope to normalize.
 * @returns True when at least one list was factored.
 */
const factorLists = (container: Container): boolean => {
  let changed = false

  for (const rule of childRules(container)) {
    const items = parseSelectorItems(rule.selector)
    if (!items || items.length < 2) continue

    const units = unitsOfList(items)
    if (!units) continue

    const [first] = units
    if (!first || units.some(unit => unit.unit !== first.unit)) continue

    const parent = postcss.rule({ selector: first.unit })
    parent.raws.before = rule.raws.before
    /*
     * See `factorSiblings`: the synthesized owner needs the factored rule's
     * source so downstream rules can contextualize it after the fix.
     */
    parent.source = rule.source
    container.insertBefore(rule, parent)

    rule.selector = units.map(unit => unit.remainder).join(', ')
    parent.append(rule)
    reindent(parent, indentOf(parent.raws.before))
    changed = true
  }

  return changed
}

/**
 * Clear formatting raws on a node so two identical bodies compare equal
 * regardless of indentation.
 * @param node - The node to normalize in place.
 */
const stripFormatting = (node: ChildNode): void => {
  node.raws.before = ''
  node.raws.after = ''

  if (node.type === 'rule' || node.type === 'atrule') {
    for (const child of node.nodes ?? []) stripFormatting(child)
  }
}

/**
 * A formatting-independent signature of a rule's complete body, or an empty
 * string when the rule has no body.
 * @param rule - The rule whose body to serialize.
 * @returns The body signature.
 */
const bodySignature = (rule: Rule): string => (
  (rule.nodes ?? []).map(node => {
    const clone = node.clone()
    stripFormatting(clone)
    return clone.toString()
  }).join('\u0000')
)

/**
 * Coalesce sibling rules whose complete bodies are identical into one rule with
 * a combined selector list, so an identical body is never duplicated.
 * @param container - The scope to normalize.
 * @returns True when at least one group was coalesced.
 */
const coalesceSiblings = (container: Container): boolean => {
  const groups = new Map<string, Rule[]>()

  for (const rule of childRules(container)) {
    if (container.type === 'root' && isComponentRoot(rule.selector)) continue

    const signature = bodySignature(rule)
    if (!signature) continue

    const group = groups.get(signature) ?? []
    group.push(rule)
    groups.set(signature, group)
  }

  let changed = false

  for (const group of groups.values()) {
    if (group.length < 2) continue

    const [first, ...rest] = group
    if (!first) continue

    const selectors = [...new Set(group.map(rule => rule.selector.trim()))]
    first.selector = selectors.join(', ')
    for (const rule of rest) rule.remove()
    reindent(first, indentOf(first.raws.before))
    changed = true
  }

  return changed
}

/**
 * Rebuild a scope into canonical ownership form: flatten redundant unary
 * branches and factor repeated owners, recursively, until stable.
 * @param container - The scope to normalize.
 * @returns True when anything changed.
 */
const canonicalize = (container: Container): boolean => {
  let changed = false

  if (hasInterpolation(container)) {
    for (const node of [...(container.nodes ?? [])]) {
      if (node.type === 'rule' || node.type === 'atrule') {
        changed = canonicalize(node as Container) || changed
      }
    }

    return changed
  }

  for (let pass = 0; pass < 100; pass += 1) {
    let passChanged = false
    if (flatten(container)) passChanged = true
    if (factorSiblings(container)) passChanged = true
    if (factorLists(container)) passChanged = true
    if (coalesceSiblings(container)) passChanged = true

    for (const node of [...(container.nodes ?? [])]) {
      if (node.type === 'rule' || node.type === 'atrule') {
        if (canonicalize(node as Container)) passChanged = true
      }
    }

    if (container.last?.type === 'decl') container.raws.semicolon = true
    if (!passChanged) break
    changed = true
  }

  return changed
}

/**
 * Requires stylesheets to be in the canonical ownership tree: nesting exists
 * only where an owner carries declarations or branches, and repeated owners are
 * factored. The rule is autofixable wherever the transformation is selector
 * equivalent.
 * @param primary - Whether the rule is enabled.
 * @returns A Stylelint rule visitor.
 */
const visitor = (primary: boolean) => (
  (root: Root, result: stylelint.PostcssResult) => {
    const validOptions = validateOptions(result, ruleName, {
      actual: primary,
      possible: [true],
    })

    if (!validOptions) return

    const clone = root.clone()
    if (!canonicalize(clone)) return

    report({
      fix: () => {
        canonicalize(root)
      },
      message: messages.rejected,
      node: root.first ?? root,
      result,
      ruleName,
    })
  }
)

/** The Basis rule that requires ownership to be expressed as recursive nesting. */
export const noAvoidableNesting = createPlugin(
  ruleName,
  Object.assign(visitor as stylelint.RuleBase, { messages, meta, ruleName }),
)
