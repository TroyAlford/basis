/**
 * Markdown + YAML front-matter authoring for reviewer policy.
 *
 * Reviewers are authored as Markdown documents: machine-readable metadata in a
 * YAML front-matter block, and the long-form adjudication guidance as the
 * document body. This module parses that form and hands the result to the
 * fail-closed validator; it performs no filesystem access.
 */

import type { ReviewerPolicy } from './types'
import { assertReviewerPolicy, isRecord, reviewPolicyError } from './validate'

/** Delimiter marking the start and end of a YAML front-matter block. */
const FRONT_MATTER_DELIMITER = '---'

/**
 * Splits a Markdown document into its YAML front-matter and body.
 * @param source Raw Markdown document.
 * @param label Value being parsed, for error messages.
 * @returns The parsed front-matter data and the trimmed body.
 */
export function parseFrontMatter(source: string, label: string): { body: string, data: unknown } {
  const lines = source.replace(/^\uFEFF/, '').split('\n')
  if (lines[0] !== FRONT_MATTER_DELIMITER) {
    reviewPolicyError(label, `must start with a "${FRONT_MATTER_DELIMITER}" front-matter block`)
  }
  const end = lines.indexOf(FRONT_MATTER_DELIMITER, 1)
  if (end === -1) reviewPolicyError(label, 'front-matter block is not closed')
  let data: unknown
  try {
    data = Bun.YAML.parse(lines.slice(1, end).join('\n'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    reviewPolicyError(label, `front-matter is not valid YAML: ${detail}`)
  }
  return { body: lines.slice(end + 1).join('\n').trim(), data }
}

/**
 * Parses a Markdown reviewer document into a validated reviewer policy. The
 * front-matter carries the machine-readable metadata and the body carries the
 * adjudication instructions.
 * @param source Raw Markdown document.
 * @param label Value being parsed, for error messages.
 * @returns The validated reviewer policy.
 */
export function parseReviewerSource(source: string, label: string): ReviewerPolicy {
  const { body, data } = parseFrontMatter(source, label)
  if (!isRecord(data)) reviewPolicyError(label, 'front-matter must be a YAML mapping')
  if ('instructions' in data) {
    reviewPolicyError(label, 'put "instructions" in the Markdown body, not the front-matter')
  }
  if (body.length === 0) reviewPolicyError(label, 'the Markdown body (instructions) must not be empty')
  return assertReviewerPolicy({ ...data, instructions: body }, label)
}
