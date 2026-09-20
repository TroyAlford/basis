/**
 * A single hunk parsed out of a unified diff.
 */
export interface PatchHunk {
  /** Raw hunk lines, including their leading ` `, `+`, `-` or `\` marker. */
  lines: string[],
  /** Number of lines the hunk contributes to the patched file. */
  newCount: number,
  /** 1-based starting line of the hunk in the patched file. */
  newStart: number,
  /** Number of lines the hunk consumes from the original file. */
  oldCount: number,
  /** 1-based starting line of the hunk in the original file. */
  oldStart: number,
}

/**
 * A single file entry parsed out of a unified diff.
 */
export interface PatchFile {
  /** Hunks that make up the change to this file. */
  hunks: PatchHunk[],
  /** Repository-relative path of the patched file. */
  newPath: string,
  /** Repository-relative path of the original file. */
  oldPath: string,
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Removes the `a/` or `b/` prefix git prepends to diff paths.
 * @param raw The path exactly as it appears in the diff header.
 * @returns The path relative to the package root.
 */
const stripDiffPrefix = (raw: string): string => raw.replace(/^[ab]\//, '')

/**
 * Parses a unified diff into its file and hunk structure.
 *
 * The parser intentionally supports only the subset of the format Basis patch
 * files use: `diff --git`, `---`, `+++` and `@@` headers plus body lines. Git
 * metadata such as `index` is ignored.
 * @param patch The textual contents of a `*.patch` file.
 * @returns One entry per file touched by the patch.
 */
export const parsePatch = (patch: string): PatchFile[] => {
  const files: PatchFile[] = []
  let current: PatchFile | undefined
  let hunk: PatchHunk | undefined

  const flushHunk = (): void => {
    if (current && hunk) current.hunks.push(hunk)
    hunk = undefined
  }

  const flushFile = (): void => {
    flushHunk()
    if (current) files.push(current)
    current = undefined
  }

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flushFile()
      current = { hunks: [], newPath: '', oldPath: '' }
      continue
    }

    if (line.startsWith('index ')) continue

    if (line.startsWith('--- ')) {
      if (!current) current = { hunks: [], newPath: '', oldPath: '' }
      current.oldPath = stripDiffPrefix(line.slice(4).trim())
      continue
    }

    if (line.startsWith('+++ ')) {
      if (!current) current = { hunks: [], newPath: '', oldPath: '' }
      current.newPath = stripDiffPrefix(line.slice(4).trim())
      continue
    }

    if (line.startsWith('@@ ')) {
      flushHunk()
      const match = HUNK_HEADER.exec(line)
      if (!match) throw new Error(`[basis] unable to parse hunk header: ${line}`)
      hunk = {
        lines: [],
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        newStart: Number(match[3]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        oldStart: Number(match[1]),
      }
      continue
    }

    if (!hunk) continue
    if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\')) {
      hunk.lines.push(line)
    }
  }

  flushFile()
  return files
}
