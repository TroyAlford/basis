import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOverlayDirectory, loadReviewerDirectory } from './load'
import { parseFrontMatter, parseReviewerOverlaySource, parseReviewerSource } from './markdown'

const VALID_REVIEWER = `---
id: sample
title: Sample
executionProfile: deterministic
context: []
detectors: []
outcomes:
  - category: ok
    disposition: no_finding
    destructive: false
threshold:
  minimumConfidence: 0.5
  severity: info
verification:
  detector: knip
---

Body guidance.
`

const VALID_ADD_OVERLAY = `---
id: repo/extra
title: Repo extra
mode: add
executionProfile: deterministic
context: []
detectors: []
outcomes:
  - category: ok
    disposition: no_finding
    destructive: false
threshold:
  minimumConfidence: 0.5
  severity: info
---

Repo guidance.
`

const EXTEND_OVERLAY = `---
id: dead-code
mode: extend
---

Local guidance.
`

const DISABLE_OVERLAY = `---
id: dead-code
mode: disable
reason: Handled elsewhere.
---
`

describe('parseFrontMatter', () => {
  test('splits YAML front-matter from the body', () => {
    const { body, data } = parseFrontMatter(VALID_REVIEWER, 'test')
    expect(body).toBe('Body guidance.')
    expect(data).toMatchObject({ id: 'sample' })
  })

  test('rejects a document without front-matter', () => {
    expect(() => parseFrontMatter('# nope', 'test')).toThrow('must start with')
  })

  test('rejects an unterminated block', () => {
    expect(() => parseFrontMatter('---\nid: x\n', 'test')).toThrow('is not closed')
  })

  test('rejects invalid YAML', () => {
    expect(() => parseFrontMatter('---\nname: [unterminated\n---\nbody\n', 'test')).toThrow('not valid YAML')
  })
})

describe('parseReviewerSource', () => {
  test('parses a valid reviewer document', () => {
    const policy = parseReviewerSource(VALID_REVIEWER, 'test')
    expect(policy.id).toBe('sample')
    expect(policy.instructions).toBe('Body guidance.')
    expect(policy.verification).toEqual({ detector: 'knip' })
  })

  test('rejects instructions in the front-matter', () => {
    const source = VALID_REVIEWER.replace('title: Sample', 'title: Sample\ninstructions: inline')
    expect(() => parseReviewerSource(source, 'test')).toThrow('in the Markdown body')
  })

  test('rejects an empty body', () => {
    expect(() => parseReviewerSource(VALID_REVIEWER.replace('Body guidance.', ''), 'test')).toThrow('must not be empty')
  })

  test('rejects unknown front-matter keys', () => {
    const source = VALID_REVIEWER.replace('title: Sample', 'title: Sample\nbogus: true')
    expect(() => parseReviewerSource(source, 'test')).toThrow('unknown field "bogus"')
  })
})

describe('parseReviewerOverlaySource', () => {
  test('parses an extend overlay with its contributed instructions', () => {
    const overlay = parseReviewerOverlaySource(EXTEND_OVERLAY, 'test')
    expect(overlay.id).toBe('dead-code')
    expect(overlay.mode).toBe('extend')
    expect(overlay.policy?.instructions).toBe('Local guidance.')
  })

  test('parses a disable overlay with its reason', () => {
    const overlay = parseReviewerOverlaySource(DISABLE_OVERLAY, 'test')
    expect(overlay).toMatchObject({ id: 'dead-code', mode: 'disable', reason: 'Handled elsewhere.' })
  })

  test('rejects a disable overlay that carries policy fields', () => {
    const source = DISABLE_OVERLAY.replace('reason: Handled elsewhere.', 'reason: off\nverification: nope')
    expect(() => parseReviewerOverlaySource(source, 'test')).toThrow('may only carry')
  })

  test('rejects a disable overlay that carries a body', () => {
    const source = '---\nid: dead-code\nmode: disable\nreason: off\n---\n\nWhy it is off.\n'
    expect(() => parseReviewerOverlaySource(source, 'test')).toThrow('must not carry a Markdown body')
  })

  test('parses an add overlay with a full policy', () => {
    const overlay = parseReviewerOverlaySource(VALID_ADD_OVERLAY, 'test')
    expect(overlay.mode).toBe('add')
    expect(overlay.policy?.id).toBe('repo/extra')
    expect(overlay.policy?.instructions).toBe('Repo guidance.')
  })

  test('rejects an overlay without a mode', () => {
    expect(() => parseReviewerOverlaySource('---\nid: dead-code\n---\nbody\n', 'test')).toThrow(
      '"mode" must be one of',
    )
  })
})

describe('directory loaders', () => {
  test('load reviewers sorted by stable id and overlays by id', () => {
    const reviewerDir = mkdtempSync(join(tmpdir(), 'basis-review-'))
    writeFileSync(join(reviewerDir, 'b.md'), VALID_REVIEWER.replace('id: sample', 'id: beta'))
    writeFileSync(join(reviewerDir, 'a.md'), VALID_REVIEWER.replace('id: sample', 'id: alpha'))
    writeFileSync(join(reviewerDir, 'notes.txt'), 'ignored')
    expect(loadReviewerDirectory(reviewerDir).map(reviewer => reviewer.id)).toEqual(['alpha', 'beta'])

    const overlayDir = mkdtempSync(join(tmpdir(), 'basis-overlay-'))
    writeFileSync(join(overlayDir, 'extend.md'), EXTEND_OVERLAY)
    writeFileSync(join(overlayDir, 'disable.md'), DISABLE_OVERLAY)
    expect(loadOverlayDirectory(overlayDir).map(overlay => overlay.mode)).toEqual(['disable', 'extend'])
  })
})
