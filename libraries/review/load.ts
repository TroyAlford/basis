/**
 * Filesystem loading of Markdown reviewer documents.
 *
 * Loading is deliberately separate from parsing: the parser is pure and
 * fail-closed, while this module is the only place that touches the filesystem.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseReviewerSource } from './markdown'
import type { ReviewerPolicy } from './types'

/** File extension for authored reviewer documents. */
const REVIEWER_EXTENSION = '.md'

/**
 * Loads every Markdown reviewer document in a directory.
 * @param directory Absolute directory to read.
 * @returns The parsed reviewers, sorted by stable id.
 */
export function loadReviewerDirectory(directory: string): ReviewerPolicy[] {
  return readdirSync(directory)
    .filter(name => name.endsWith(REVIEWER_EXTENSION))
    .sort()
    .map(name => parseReviewerSource(readFileSync(join(directory, name), 'utf8'), `reviewer "${name}"`))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}
