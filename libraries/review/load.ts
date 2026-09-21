/**
 * Filesystem loading of Markdown reviewer and overlay documents.
 *
 * Loading is deliberately separate from parsing: the parser is pure and
 * fail-closed, while this module is the only place that touches the filesystem.
 * Directory reads are sorted so loading is deterministic.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseReviewerOverlaySource, parseReviewerSource } from './markdown'
import type { ReviewerOverlay, ReviewerPolicy } from './types'

/** File extension for authored policy documents. */
const MARKDOWN_EXTENSION = '.md'

/**
 * Reads every Markdown document in a directory, sorted by filename.
 * @param directory Absolute directory to read.
 * @returns The document sources and their labels.
 */
function readDocuments(directory: string): { label: string, source: string }[] {
  return readdirSync(directory)
    .filter(name => name.endsWith(MARKDOWN_EXTENSION))
    .sort()
    .map(name => ({ label: `"${name}"`, source: readFileSync(join(directory, name), 'utf8') }))
}

/**
 * Loads every standard Markdown reviewer document in a directory.
 * @param directory Absolute directory to read.
 * @returns The parsed reviewers, sorted by stable id.
 */
export function loadReviewerDirectory(directory: string): ReviewerPolicy[] {
  return readDocuments(directory)
    .map(document => parseReviewerSource(document.source, document.label))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Loads every repository-local Markdown overlay document in a directory.
 * @param directory Absolute directory to read.
 * @returns The parsed overlays, sorted by stable id.
 */
export function loadOverlayDirectory(directory: string): ReviewerOverlay[] {
  return readDocuments(directory)
    .map(document => parseReviewerOverlaySource(document.source, document.label))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}
