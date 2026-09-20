import type { PatchFile, PatchHunk } from './parse'

/**
 * Outcome of applying a single parsed patch file to a single source file.
 */
export interface ApplyPatchResult {
  /** Whether any hunk changed the file contents. */
  applied: boolean,
  /** The resulting file contents (identical to the input when nothing applied). */
  content: string,
}

/**
 * Splits file contents into lines while remembering whether the file ended with
 * a newline so the trailing-newline state can be reproduced exactly.
 * @param text The full contents of a file.
 * @returns The lines plus the original trailing-newline state.
 */
const splitLines = (text: string): { lines: string[], trailingNewline: boolean } => {
  const trailingNewline = text.endsWith('\n')
  const body = trailingNewline ? text.slice(0, -1) : text
  return { lines: body.length === 0 ? [] : body.split('\n'), trailingNewline }
}

/**
 * Extracts the lines a hunk contributes to one side of the diff by stripping the
 * marker character from context and matching body lines.
 * @param hunk The parsed hunk.
 * @param marker The marker whose lines belong to the requested side (`-` or `+`).
 * @returns The bare line contents for that side.
 */
const sideLines = (hunk: PatchHunk, marker: string): string[] => hunk.lines
  .filter(line => line.startsWith(' ') || line.startsWith(marker))
  .map(line => line.slice(1))

/**
 * Finds the first index at or after `from` where `needle` appears in `haystack`.
 * @param haystack The lines to search.
 * @param needle The contiguous sequence of lines to locate.
 * @param from The zero-based index to start searching from.
 * @returns The match index, or `-1` when the sequence is absent.
 */
const indexOfSequence = (haystack: string[], needle: string[], from: number): number => {
  if (needle.length === 0) return from
  for (let index = Math.max(0, from); index <= haystack.length - needle.length; index += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) return index
  }
  return -1
}

/**
 * Applies one parsed patch file to in-memory file contents.
 *
 * Hunks are located by their exact old (context + removed) lines. When those
 * lines are absent but the new lines are already present, the hunk is treated
 * as already applied so repeated installs stay idempotent. A hunk that matches
 * neither side throws so a drifted dependency fails loudly instead of silently
 * running unpatched code.
 * @param original The current contents of the file.
 * @param file The parsed diff entry describing the change.
 * @returns The resulting contents and whether anything changed.
 */
export const applyPatchToText = (original: string, file: PatchFile): ApplyPatchResult => {
  const { lines, trailingNewline } = splitLines(original)
  let result = lines
  let applied = false

  for (const hunk of file.hunks) {
    const oldLines = sideLines(hunk, '-')
    const newLines = sideLines(hunk, '+')
    if (oldLines.length === 0 && newLines.length === 0) continue

    const preferred = indexOfSequence(result, oldLines, hunk.oldStart - 1)
    const located = preferred === -1 ? indexOfSequence(result, oldLines, 0) : preferred

    if (located !== -1) {
      result = [...result.slice(0, located), ...newLines, ...result.slice(located + oldLines.length)]
      applied = true
      continue
    }

    if (indexOfSequence(result, newLines, 0) !== -1) continue

    throw new Error(`[basis] hunk at line ${hunk.oldStart} did not apply to ${file.newPath}`)
  }

  return { applied, content: `${result.join('\n')}${trailingNewline ? '\n' : ''}` }
}
