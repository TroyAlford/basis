import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadReviewerDirectory } from './load'
import { parseFrontMatter, parseReviewerSource } from './markdown'

const VALID = `---
id: sample
title: Sample
question: Is this a sample?
executionProfile: deterministic
context: []
detectors: []
evidence: []
outOfScope: []
outcomes:
  - category: ok
    description: Nothing to do.
    destructive: false
    outcome: no_finding
threshold:
  minimumConfidence: 0.5
  severity: info
---

Body guidance.
`

describe('parseFrontMatter', () => {
  test('splits YAML front-matter from the body', () => {
    const { body, data } = parseFrontMatter(VALID, 'test')
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
    const policy = parseReviewerSource(VALID, 'test')
    expect(policy.id).toBe('sample')
    expect(policy.instructions).toBe('Body guidance.')
  })

  test('rejects instructions in the front-matter', () => {
    const source = VALID.replace('title: Sample', 'title: Sample\ninstructions: inline')
    expect(() => parseReviewerSource(source, 'test')).toThrow('in the Markdown body')
  })

  test('rejects an empty body', () => {
    expect(() => parseReviewerSource(VALID.replace('Body guidance.', ''), 'test')).toThrow('must not be empty')
  })

  test('rejects unknown front-matter keys', () => {
    const source = VALID.replace('title: Sample', 'title: Sample\nbogus: true')
    expect(() => parseReviewerSource(source, 'test')).toThrow('unknown field "bogus"')
  })
})

describe('loadReviewerDirectory', () => {
  test('loads Markdown reviewers sorted by stable id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'basis-review-'))
    writeFileSync(join(dir, 'b.md'), VALID.replace('id: sample', 'id: beta'))
    writeFileSync(join(dir, 'a.md'), VALID.replace('id: sample', 'id: alpha'))
    writeFileSync(join(dir, 'notes.txt'), 'ignored')

    expect(loadReviewerDirectory(dir).map(reviewer => reviewer.id)).toEqual(['alpha', 'beta'])
  })
})
