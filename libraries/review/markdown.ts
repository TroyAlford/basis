/**
 * Markdown + YAML front-matter authoring for reviewer policy.
 *
 * Humans and LLMs author Markdown; Basis validates it; the runtime consumes
 * typed objects. A document's front-matter carries only the mechanical
 * metadata the runtime needs, and the body carries the engineering principle,
 * reasoning, and instructions. This module parses that form and hands the
 * result to the fail-closed validator; it performs no filesystem access.
 */

import type { ReviewerOverlay, ReviewerPolicy } from './types'
import { assertReviewerOverlay, assertReviewerPolicy, isRecord, reviewPolicyError } from './validate'

/** Delimiter marking the start and end of a YAML front-matter block. */
const FRONT_MATTER_DELIMITER = '---'

/** Overlay front-matter keys that are not part of the reviewer policy. */
const OVERLAY_CONTROL_KEYS = ['id', 'mode', 'reason'] as const

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
 * Parses a standard Markdown reviewer document into a validated policy. The
 * front-matter carries the mechanical metadata and the body carries the
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

/**
 * Parses a repository-local Markdown overlay document into a validated overlay.
 * `id` and `mode` are required; `reason` is required for `disable`. The body is
 * the overlay's contributed instructions.
 * @param source Raw Markdown document.
 * @param label Value being parsed, for error messages.
 * @returns The validated overlay.
 */
export function parseReviewerOverlaySource(source: string, label: string): ReviewerOverlay {
  const { body, data } = parseFrontMatter(source, label)
  if (!isRecord(data)) reviewPolicyError(label, 'front-matter must be a YAML mapping')

  const { id, mode, reason, ...policyFields } = data
  const overlay: Record<string, unknown> = { id, mode }
  if (reason !== undefined) overlay.reason = reason

  if (mode === 'disable') {
    if (body.length > 0) {
      reviewPolicyError(label, 'disable overlays must not carry a Markdown body')
    }
    if (Object.keys(policyFields).length > 0) {
      reviewPolicyError(label, `disable overlays may only carry: ${OVERLAY_CONTROL_KEYS.join(', ')}`)
    }
  } else {
    const policy: Record<string, unknown> = { ...policyFields }
    if (id !== undefined) policy.id = id
    if (body.length > 0) policy.instructions = body
    overlay.policy = policy
  }
  return assertReviewerOverlay(overlay)
}
