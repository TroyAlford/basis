/**
 * Bans direct browser lifecycle ownership in tests.
 *
 * Basis starts the browser once, shares it across the run, and closes it at
 * teardown. Tests visit pages through `useApplication().visit()`.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { exportPath, fromSource, resolveReference, staticStrings } from './imports'
import { isBasisRunner, isProcessExecution } from './processes'

const BROWSER_SOURCES: readonly string[] = [
  '@playwright/test',
  'playwright',
  'playwright-core',
  'puppeteer',
  'puppeteer-core',
]

const LIFECYCLE_METHODS: ReadonlySet<string> = new Set([
  'connect',
  'connectOverCDP',
  'launch',
  'launchPersistentContext',
  'launchServer',
])

// Whether a reference is a direct browser launch or connection.
const isBrowserLifecycle = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  if (!fromSource(reference, BROWSER_SOURCES)) return false
  const path = exportPath(reference)
  const name = path[path.length - 1]
  return name !== undefined && LIFECYCLE_METHODS.has(name)
}

// Whether static command text starts a Playwright browser server.
const launchesBrowserServer = (strings: readonly string[]): boolean => {
  const command = strings.join(' ')
  return /\bplaywright\b/i.test(command) && /\brun-server\b/i.test(command)
}

export const noDirectBrowserLifecycle: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node): void => {
      context.report({ messageId: 'noDirectBrowserLifecycle', node })
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        if (isBrowserLifecycle(reference)) {
          report(node)
          return
        }
        if (!isProcessExecution(reference) && !isBasisRunner(reference)) return
        if (launchesBrowserServer(staticStrings(node.arguments))) report(node)
      },
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis application fixture instead of direct browser ownership.',
    },
    messages: {
      noDirectBrowserLifecycle: [
        'Tests must not launch or connect to a browser directly.',
        ' Use `useApplication` from `basis/testing` and drive the page through `visit()` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
