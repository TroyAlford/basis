#!/usr/bin/env bun
/* eslint-disable no-console -- this is an operator-facing benchmark command. */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { arch, cpus, release, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'

/*
 * Reproducible local image-provisioning benchmark.
 *
 * This measures the current pinned Playwright image against a warm local cache
 * and, with --save-load, the docker save/load cost of a cache artifact. It does
 * not remove the image or running containers, so it cannot produce a cold-pull
 * number on a shared daemon. The hosted cold-pull data in docs/ci.mdx comes from
 * the Alforge/ai pilot logs and is labelled separately.
 */

const root = join(import.meta.dir, '..')
const saveLoad = process.argv.includes('--save-load')

/**
 * Run a command and measure its wall-clock duration.
 * @param command Command and arguments.
 * @param cwd Working directory.
 * @returns Duration, exit code, and captured output.
 */
function measure(command: string[], cwd = root): { code: number, ms: number, output: string } {
  const start = performance.now()
  const result = Bun.spawnSync(command, { cwd, stderr: 'pipe', stdout: 'pipe' })
  const ms = performance.now() - start
  const decoder = new TextDecoder()
  return {
    code: result.exitCode ?? -1,
    ms,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`.trim(),
  }
}

/**
 * Format milliseconds for the report.
 * @param ms Duration in milliseconds.
 * @returns A seconds string.
 */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`
}

/**
 * Report a failed measurement and keep the benchmark honest.
 * @param label Step label.
 * @param measurement Measured result.
 * @param measurement.code Process exit code.
 * @param measurement.output Captured output.
 */
function requireSuccess(label: string, measurement: { code: number, output: string }): void {
  if (measurement.code === 0) return
  console.error(`${label} failed with exit ${measurement.code}\n${measurement.output}`)
  process.exit(1)
}

const playwright = JSON.parse(
  await Bun.file(join(root, 'node_modules/playwright/package.json')).text(),
) as { version: string }
const image = `mcr.microsoft.com/playwright:v${playwright.version}-noble`

const present = measure(['docker', 'image', 'inspect', image, '--format', '{{json .}}'])
const cacheState = present.code === 0 ? 'warm' : 'missing'

const inspect = measure(['docker', 'image', 'inspect', image, '--format', '{{.Size}} {{index .RepoDigests 0}}'])
const [size, digest] = inspect.code === 0 ? inspect.output.split(' ') : ['unknown', 'unknown']

const pull = measure(['docker', 'pull', image])
requireSuccess('docker pull', pull)

const start = measure([
  'docker', 'run', '--rm', '--pull', 'missing', image,
  'node', '-e', 'console.log(process.version)',
])
requireSuccess('docker run', start)

const snapshot = measure([
  process.execPath, 'test', 'libraries/testing/matchScreenshot.test.tsx',
])
requireSuccess('snapshot test', snapshot)

let saveSeconds = 'skipped'
let loadSeconds = 'skipped'
let archiveBytes = 'skipped'
if (saveLoad) {
  const directory = await mkdtemp(join(tmpdir(), 'basis-snapshot-benchmark-'))
  const archive = join(directory, 'image.tar')
  try {
    const save = measure(['docker', 'save', image, '-o', archive])
    requireSuccess('docker save', save)
    saveSeconds = seconds(save.ms)
    archiveBytes = `${((await stat(archive)).size / (1024 ** 3)).toFixed(2)} GiB`

    const load = measure(['docker', 'load', '-i', archive])
    requireSuccess('docker load', load)
    loadSeconds = seconds(load.ms)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

const docker = measure(['docker', 'version', '--format', '{{.Server.Version}}'])
const bun = measure([process.execPath, '--version'])

console.log('\n# Snapshot image benchmark\n')
console.log(`- Date: ${new Date().toISOString()}`)
console.log(`- Host: ${release()}, ${arch()}, ${cpus().length} vCPU, ${(totalmem() / (1024 ** 3)).toFixed(0)} GiB RAM`)
console.log(`- Docker: ${docker.output}`)
console.log(`- Bun: ${bun.output}`)
console.log(`- Playwright: ${playwright.version}`)
console.log(`- Image: \`${image}\` (${digest}, ${size} bytes, ${cacheState} cache)`)
console.log('')
console.log('| Measurement | Result |')
console.log('| --- | --- |')
console.log(`| image inspect | ${present.code === 0 ? 'present' : 'missing'} |`)
console.log(`| pull (${cacheState}) | ${seconds(pull.ms)} |`)
console.log(`| container start | ${seconds(start.ms)} |`)
console.log(`| save | ${saveSeconds}${archiveBytes === 'skipped' ? '' : `, ${archiveBytes}`} |`)
console.log(`| load | ${loadSeconds} |`)
console.log(`| one snapshot capture | ${seconds(snapshot.ms)} |`)
console.log('')
console.log('Cold-pull timing is not measured: removing the image would disrupt running containers,')
console.log('and a local arm64 pull is not comparable to hosted amd64 runners.')
console.log('Use the hosted pilot data in docs/ci.mdx for that comparison.')
