#!/usr/bin/env bun
/* eslint-disable no-console -- this is an operator-facing benchmark command. */
import { join } from 'node:path'

/*
 * Measure the change-impact preflight on the current branch.
 *
 * This is a local diagnostic, not the production policy path: it reads the
 * example policy from the working tree because Basis does not yet commit a
 * `.github/ci-impact.json`. The GitHub Action always reads the policy from the
 * exact merge base.
 */

const root = join(import.meta.dir, '..')
const baseRef = process.argv[2] ?? 'upstream/main'
const start = performance.now()
const result = Bun.spawnSync([
  process.execPath,
  join(root, '.github/actions/change-impact/index.ts'),
  '--cwd',
  root,
  '--base-ref',
  baseRef,
  '--head-sha',
  'HEAD',
  '--config-path',
  'docs/examples/ci-impact.json',
  '--config-source',
  'head',
], {
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe',
})

const elapsed = performance.now() - start
if (result.exitCode !== 0) {
  console.error(new TextDecoder().decode(result.stderr).trim())
  process.exit(result.exitCode ?? 1)
}

const decision = JSON.parse(new TextDecoder().decode(result.stdout)) as {
  changedFiles: unknown[],
  docsOnly: boolean,
  suites: Record<string, { needed: boolean, reason: string, selectedTests: string[] }>,
}

console.log('\n# Change-impact preflight benchmark\n')
console.log(`- Date: ${new Date().toISOString()}`)
console.log(`- Base ref: ${baseRef}`)
console.log(`- Changed files: ${decision.changedFiles.length}`)
console.log(`- Docs only: ${decision.docsOnly}`)
console.log(`- Analyzer wall clock: ${(elapsed / 1000).toFixed(3)} s`)
console.log('')
console.log('| Suite | Needed | Reason | Selected tests |')
console.log('| --- | --- | --- | --- |')
for (const [key, suite] of Object.entries(decision.suites)) {
  console.log(`| ${key} | ${suite.needed} | ${suite.reason} | ${suite.selectedTests.length} |`)
}
console.log('')
console.log('The hosted preflight also pays checkout, base fetch and Bun setup, so it bills as one minute.')
console.log('A visual job is reported at 62–81 s plus a 36–55 s pinned-image pull;')
console.log('skipping it is the saving that pays for the preflight.')
