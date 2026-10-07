import type { Pluggable } from 'unified'
import { noParagraphLineBreaks } from './noParagraphLineBreaks'

export { noParagraphLineBreaks }

/** Every Basis-owned Markdown rule, in report order. */
export const basisRules: Pluggable[] = [noParagraphLineBreaks]
