import type { Rule, Scope } from 'eslint'
import type * as ESTree from 'estree'

/**
 * Whether a callee is a recognized database or fixture transaction method.
 * @param callee - Call callee.
 * @returns `true` for recognized `.tx` calls.
 */
function isTransaction(callee: ESTree.Expression | ESTree.Super): boolean {
  if (callee.type !== 'MemberExpression' || callee.computed) return false
  const property = callee.property
  if (property.type !== 'Identifier' || property.name !== 'tx') return false
  const object = callee.object
  if (object.type === 'Identifier') return object.name === 'db' || object.name === 'database'
  if (object.type === 'MemberExpression' && !object.computed && object.property.type === 'Identifier') {
    return object.property.name === 'db'
  }
  return false
}

export const transactionSqlName: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: ESTree.CallExpression): void {
        if (!isTransaction(node.callee)) return
        const callback = node.arguments[0]
        if (
          !callback
          || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')
        ) {
          return
        }
        const parameter = callback.params[0]
        if (!parameter || parameter.type !== 'Identifier' || parameter.name === 'sql') return

        const scope = context.sourceCode.getScope(callback)
        const variable = scope.variables.find(candidate => candidate.name === parameter.name)
        const text = context.sourceCode.getText(callback)
        const collides = scope.set.has('sql')
          || Boolean(scope.upper && hasOuterSql(scope.upper))
          || /\bsql\b/.test(text)
        const safe = Boolean(variable) && !collides

        let fix: ((fixer: Rule.RuleFixer) => Rule.Fix[]) | null = null
        if (safe && variable) {
          fix = (fixer): Rule.Fix[] => [
            fixer.replaceText(parameter, 'sql'),
            ...variable.references.map(reference => fixer.replaceText(
              reference.identifier as ESTree.Identifier,
              'sql',
            )),
          ]
        }
        context.report({
          data: { name: parameter.name },
          fix,
          messageId: 'transactionSqlName',
          node: parameter,
        })
      },
    }
  },
  meta: {
    docs: {
      description: 'Require recognized database transaction callbacks to name their SQL binding `sql`.',
    },
    fixable: 'code',
    messages: {
      transactionSqlName: "Use 'sql' for the transaction SQL binding instead of '{{name}}'.",
    },
    schema: [],
    type: 'suggestion',
  },
}

/**
 * Whether an outer scope already binds `sql`.
 * @param scope - Scope to inspect.
 * @returns `true` when `sql` is already bound.
 */
function hasOuterSql(scope: Scope.Scope): boolean {
  let current: Scope.Scope | null = scope
  while (current) {
    if (current.set.has('sql')) return true
    current = current.upper
  }
  return false
}
