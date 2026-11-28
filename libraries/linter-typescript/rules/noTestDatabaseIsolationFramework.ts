/**
 * Bans per-test database isolation frameworks.
 *
 * One Basis fixture owns the schema, seed data, and transaction boundaries.
 * Tests must not create their own schemas or databases, switch search paths, or
 * swap in an embedded database manager.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { fromSource, memberProperty, resolveReference, staticStrings } from './imports'
import { isBasisRunner, isProcessExecution } from './processes'

const ALTERNATIVE_SOURCES: readonly string[] = [
  '@electric-sql/pglite',
  '@libsql/client',
  'better-sqlite3',
  'knex',
  'pg-mem',
  'pglite',
  'sql.js',
  'sqlite3',
]

// SQL that creates or selects an independent database namespace.
const ISOLATION_SQL = new RegExp([
  '\\b(?:alter|create|drop)\\s+(?:database|schema)\\b',
  '|\\bset\\s+(?:search_path|schema)\\b',
  '|\\bsearch_path\\s*=',
].join(''), 'i')

// Local database-management commands that bypass the fixture.
const ISOLATION_COMMAND = /\b(?:createdb|dropdb|initdb|pg_ctl)\b/i

// Methods whose arguments are SQL text rather than arbitrary prose.
const SQL_METHODS: ReadonlySet<string> = new Set([
  'execute',
  'exec',
  'query',
  'run',
  'sql',
  'tx',
  'unsafe',
])

// Whether a reference is an alternative embedded or isolation database manager.
const isAlternativeManager = (reference: ResolvedReference | null): boolean => (
  reference !== null && fromSource(reference, ALTERNATIVE_SOURCES)
)

// Whether a psql invocation carries isolation SQL.
const isPsqlIsolation = (strings: readonly string[]): boolean => {
  const command = strings.join(' ')
  return /\bpsql\b/i.test(command) && ISOLATION_SQL.test(command)
}

// Whether a call's arguments are SQL text.
const isSqlCall = (callee: ESTree.Node): boolean => {
  const method = memberProperty(callee)
  return method !== null && SQL_METHODS.has(method)
}

export const noTestDatabaseIsolationFramework: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node): void => {
      context.report({ messageId: 'noTestDatabaseIsolationFramework', node })
    }

    const checkCommand = (node: ESTree.Node, strings: readonly string[]): void => {
      const command = strings.join(' ')
      if (ISOLATION_COMMAND.test(command) || isPsqlIsolation(strings)) report(node)
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        if (isAlternativeManager(reference)) {
          report(node)
          return
        }
        const strings = staticStrings(node.arguments)
        if (isSqlCall(node.callee) && ISOLATION_SQL.test(strings.join(' '))) {
          report(node)
          return
        }
        if (!isProcessExecution(reference) && !isBasisRunner(reference)) return
        checkCommand(node, strings)
      },
      NewExpression(node: ESTree.NewExpression) {
        if (isAlternativeManager(resolveReference(context, node.callee))) report(node)
      },
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression) {
        const strings = staticStrings(node.quasi)
        if (ISOLATION_SQL.test(strings.join(' '))) report(node)
      },
    }
  },
  meta: {
    docs: {
      description: 'Require the single Basis database fixture instead of custom isolation.',
    },
    messages: {
      noTestDatabaseIsolationFramework: [
        'Custom schemas, independent test databases, and alternative database managers are not allowed.',
        ' Use the single Basis database fixture and its prescribed test data/seeding API instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
