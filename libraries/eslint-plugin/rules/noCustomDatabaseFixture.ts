/**
 * Bans consumer-owned database fixtures.
 *
 * The Basis fixture owns the single PostgreSQL instance, its lifecycle, and its
 * seed data. Consumer tests must not provision containers, construct their own
 * clients, or start database processes.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { exportPath, fromSource, resolveReference, staticStrings } from './imports'
import { isBasisRunner, isProcessExecution } from './processes'

const CLIENT_SOURCES: readonly string[] = ['pg', 'pg-pool', 'pg-promise', 'postgres', 'slonik']

const CLIENT_EXPORTS: ReadonlySet<string> = new Set(['Client', 'Pool', 'SQL', 'createPool'])

// Libraries whose entrypoint is a callable database client factory.
const DEFAULT_CLIENT_SOURCES: readonly string[] = ['pg-promise', 'postgres', 'slonik']

const CONTAINER_SOURCES: readonly string[] = ['@testcontainers/postgresql', 'testcontainers']

// Docker or Podman commands that provision a PostgreSQL container.
const CONTAINER_COMMAND = /\b(?:docker|nerdctl|podman)\b/i
const POSTGRES_IMAGE = /\bpgvector\b|\bpostgres(?:ql)?\b/i

// Whether a reference constructs a database client.
const isDatabaseClient = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  const path = exportPath(reference)
  if (fromSource(reference, ['bun'])) {
    return path.length === 1 && path[0] === 'SQL'
  }
  if (!fromSource(reference, CLIENT_SOURCES)) return false
  if (path.length === 0) {
    return DEFAULT_CLIENT_SOURCES.some(source => fromSource(reference, [source]))
  }
  const [name] = path
  return name !== undefined && CLIENT_EXPORTS.has(name)
}

// Whether a reference constructs a database container.
const isContainer = (reference: ResolvedReference | null): boolean => (
  reference !== null && fromSource(reference, CONTAINER_SOURCES)
)

// Whether static command text provisions a PostgreSQL container.
const provisionsContainer = (strings: readonly string[]): boolean => {
  const command = strings.join(' ')
  return CONTAINER_COMMAND.test(command) && POSTGRES_IMAGE.test(command)
}

export const noCustomDatabaseFixture: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node): void => {
      context.report({ messageId: 'noCustomDatabaseFixture', node })
    }

    const checkCall = (node: ESTree.CallExpression | ESTree.NewExpression): void => {
      const reference = resolveReference(context, node.callee)
      if (isDatabaseClient(reference) || isContainer(reference)) {
        report(node)
        return
      }
      if (!isProcessExecution(reference) && !isBasisRunner(reference)) return
      if (provisionsContainer(staticStrings(node.arguments))) report(node)
    }

    return {
      CallExpression: checkCall,
      NewExpression: checkCall,
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis database fixture instead of a consumer-owned database.',
    },
    messages: {
      noCustomDatabaseFixture: [
        'Consumer-owned database containers, clients, and fixtures are not allowed.',
        ' Use `useDatabaseFixture` from `basis/testing` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
