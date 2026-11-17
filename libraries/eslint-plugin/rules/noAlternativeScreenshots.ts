/**
 * Bans alternative screenshot capture and comparison.
 *
 * `matchScreenshot` from `basis/testing` owns capture, baseline lookup,
 * comparison, and diff output.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { fromSource, memberProperty, resolveReference } from './imports'

const IMAGE_SOURCES: readonly string[] = [
  'blink-diff',
  'jest-image-snapshot',
  'jimp',
  'looks-same',
  'pixelmatch',
  'pngjs',
  'resemblejs',
  'sharp',
]

const SCREENSHOT_METHODS: ReadonlySet<string> = new Set([
  'screenshot',
  'toHaveScreenshot',
  'toMatchImageSnapshot',
])

// Whether a reference is an image capture or comparison library.
const isImageLibrary = (reference: ResolvedReference | null): boolean => (
  reference !== null && fromSource(reference, IMAGE_SOURCES)
)

export const noAlternativeScreenshots: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node): void => {
      context.report({ messageId: 'noAlternativeScreenshots', node })
    }

    const check = (node: ESTree.CallExpression | ESTree.NewExpression): void => {
      const reference = resolveReference(context, node.callee)
      if (isImageLibrary(reference)) {
        report(node)
        return
      }
      const method = memberProperty(node.callee)
      if (method !== null && SCREENSHOT_METHODS.has(method)) report(node)
    }

    return {
      CallExpression: check,
      NewExpression: check,
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis screenshot matcher instead of custom capture or comparison.',
    },
    messages: {
      noAlternativeScreenshots: [
        'Direct screenshot capture, image comparison, and screenshot assertions are not allowed.',
        ' Use `matchScreenshot` from `basis/testing` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
