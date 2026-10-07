import type { Root } from 'mdast'
import { lintRule } from 'unified-lint-rule'
import { visit } from 'unist-util-visit'

/** A soft line break inside a `text` node, and the indentation around it. */
const SOFT_LINE_BREAK = /[ \t]*\n[ \t]*/g

/**
 * Forbids breaking a paragraph across multiple source lines.
 *
 * A renderer treats a soft line break as a space and word-wraps the paragraph
 * itself, so wrapping it in source only adds diff and re-wrap churn. The
 * autofix joins the soft-wrapped lines; hard breaks (`break` nodes) are left
 * intact.
 */
export const noParagraphLineBreaks = lintRule<Root>(
  'basis:no-paragraph-line-breaks',
  (tree, file) => {
    visit(tree, 'paragraph', node => {
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value.includes('\n')) continue
        file.message('Do not break a paragraph across lines; let the renderer word-wrap', child)
        child.value = child.value.replace(SOFT_LINE_BREAK, ' ')
      }
    })
  },
)
