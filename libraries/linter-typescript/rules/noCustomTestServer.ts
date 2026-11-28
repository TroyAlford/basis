/**
 * Bans test-owned application servers.
 *
 * Basis owns the application fixture: it starts the server, waits for
 * readiness, exposes it to the browser, and tears it down after the run. A
 * bounded runner such as `runAsync` does not change that; it is a command
 * runner, not an application fixture.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { exportPath, fromGlobal, fromSource, resolveReference, staticStrings } from './imports'
import { isBasisRunner, isProcessExecution } from './processes'

const SERVER_MODULES: readonly string[] = ['http', 'http2', 'https', 'net', 'tls']

const SERVER_EXPORTS: ReadonlySet<string> = new Set(['createSecureServer', 'createServer'])

// Application test lanes own the shared Basis application fixture.
const APPLICATION_LANE = /\.(?:e2e|screenshot|spec)\.[cm]?[jt]sx?$/i

// Basis's first-party server and managed-database constructors.
const BASIS_SERVER_SOURCES: readonly string[] = ['basis/server', '@basis/server']
const BASIS_DATABASE_SOURCES: readonly string[] = ['basis/server', '@basis/server']
const SERVER_MODULE = /(?:^|\/)Server(?:\.[cm]?[jt]sx?)?$/u
const DATABASE_MODULE = /(?:^|\/)Database(?:\.[cm]?[jt]sx?)?$/u
const MANAGED_POSTGRES_MODULE = /(?:^|\/)ManagedPostgresService(?:\.[cm]?[jt]sx?)?$/u
const DATABASE_PROVISIONERS: ReadonlySet<string> = new Set([
  'createDatabase',
  'ManagedDatabase',
  'ManagedPostgresService',
])

// Test artifacts that mention a server are still test commands, not launches.
const TEST_ARTIFACT = /\.(?:e2e|screenshot|spec|test)\.[cm]?[jt]sx?/i

// Commands that never start an application server.
const NON_SERVER_COMMAND = new RegExp([
  '^(?:',
  'git\\b|',
  'eslint\\b|tsc\\b|stylelint\\b|prettier\\b|knip\\b|',
  'bunx?\\s+(?:test\\b|--check\\b|run\\s+(?:test|lint|typecheck|build|format|docs|ci)\\b)|',
  'npm\\s+(?:test\\b|run\\s+(?:test|lint|typecheck|build|format|docs|ci)\\b)|',
  'pnpm\\s+(?:test\\b|run\\s+(?:test|lint|typecheck|build|format|docs|ci)\\b)|',
  'yarn\\s+(?:test\\b|run\\s+(?:test|lint|typecheck|build|format|docs|ci)\\b)',
  ')',
].join(''), 'i')

// Words that indicate a long-lived application server.
const SERVER_WORD = /(?:^|[\s/._'"-])(?:dev|listen|serve|server|start)(?:$|[\s/._'"-])/i

// A port binding is an application-server launch even without a server word.
const PORT_BINDING = /(?:^|\s)(?:--port|-p|PORT=)\S*/i

// Container lifecycle commands publish ports but do not start an application.
const CONTAINER_COMMAND = /^\s*(?:docker|nerdctl|podman)\b/i

// Whether a call is a direct server constructor.
const isDirectServer = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  if (fromGlobal(reference, ['Bun'])) {
    const path = exportPath(reference)
    return path.length === 1 && path[0] === 'serve'
  }
  if (!fromSource(reference, SERVER_MODULES)) return false
  const path = exportPath(reference)
  return path.length === 1 && path[0] !== undefined && SERVER_EXPORTS.has(path[0])
}

// The imported or default export name behind a reference.
const referenceName = (reference: ResolvedReference): string | undefined => {
  const [name] = exportPath(reference)
  if (name !== undefined) return name
  return reference.path[0] === 'default' ? 'default' : undefined
}

// Whether a reference constructs Basis's first-party application server.
const isBasisServer = (reference: ResolvedReference | null): boolean => {
  if (!reference || reference.origin.kind !== 'module') return false
  const name = referenceName(reference)
  if (name !== 'Server' && name !== 'default') return false
  const source = reference.origin.source
  return fromSource(reference, BASIS_SERVER_SOURCES) || SERVER_MODULE.test(source)
}

// Whether a reference constructs a managed database outside the shared fixture.
const isBasisDatabaseProvisioner = (reference: ResolvedReference | null): boolean => {
  if (!reference || reference.origin.kind !== 'module') return false
  const name = referenceName(reference)
  if (name === undefined || !DATABASE_PROVISIONERS.has(name)) return false
  const source = reference.origin.source
  return fromSource(reference, BASIS_DATABASE_SOURCES)
    || DATABASE_MODULE.test(source)
    || MANAGED_POSTGRES_MODULE.test(source)
}

// Whether static command text describes starting an application server.
const looksLikeServerLaunch = (strings: readonly string[]): boolean => {
  const command = strings.map(value => value.trim()).filter(value => value.length > 0).join(' ')
  if (command.length === 0) return false
  if (TEST_ARTIFACT.test(command)) return false
  if (NON_SERVER_COMMAND.test(command)) return false
  if (CONTAINER_COMMAND.test(command)) return false
  return SERVER_WORD.test(command) || PORT_BINDING.test(command)
}

export const noCustomTestServer: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node, messageId = 'noCustomTestServer'): void => {
      context.report({ messageId, node })
    }
    const applicationLane = APPLICATION_LANE.test(context.filename)

    const checkProcess = (
      node: ESTree.Node,
      reference: ResolvedReference | null,
      strings: readonly string[],
    ): void => {
      if (!isProcessExecution(reference) && !isBasisRunner(reference)) return
      if (looksLikeServerLaunch(strings)) report(node)
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        if (isDirectServer(reference)) {
          report(node)
          return
        }
        if (applicationLane && isBasisDatabaseProvisioner(reference)) {
          report(node, 'noCustomTestDatabase')
          return
        }
        checkProcess(node, reference, staticStrings(node.arguments))
      },
      NewExpression(node: ESTree.NewExpression) {
        const reference = resolveReference(context, node.callee)
        if (applicationLane && isBasisServer(reference)) {
          report(node)
          return
        }
        if (applicationLane && isBasisDatabaseProvisioner(reference)) {
          report(node, 'noCustomTestDatabase')
          return
        }
        if (isDirectServer(reference)) report(node)
      },
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression) {
        const reference = resolveReference(context, node.tag)
        if (isDirectServer(reference)) {
          report(node)
          return
        }
        checkProcess(node, reference, staticStrings(node.quasi))
      },
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis application and database fixtures instead of test-owned services.',
    },
    messages: {
      noCustomTestDatabase: [
        'Tests must not provision a managed database.',
        ' Use `withDatabase` from `basis/testing` instead.',
      ].join(''),
      noCustomTestServer: [
        'Tests must not start or own an application server.',
        ' Use `useApplication` from `basis/testing` and drive the app through `visit()` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
