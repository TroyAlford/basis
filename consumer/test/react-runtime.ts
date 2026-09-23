import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { findInstalledInstances } from '../patches/install'
import { assert, assertDoctorOk, assertNoBasisRuntimeHacks, assertNodeFree, initReactApp, makeTempDir, makeToolPath, run } from './harness'

/** A running external consumer server. */
interface ConsumerServer {
  /** The port the server bound. */
  port: number,
  /** Sends SIGTERM and resolves with the child's exit code. */
  stop: () => Promise<number>,
}

/**
 * Spawns the fixture's managed-production server and waits for its readiness line.
 * @param app Absolute path to the fixture app.
 * @param env Restricted environment for the child.
 * @returns The bound port and an idempotent stop.
 */
const startManagedServer = async (
  app: string,
  env: Record<string, string>,
): Promise<ConsumerServer> => {
  const proc = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: app,
    env: { ...process.env, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let port: number | null = null
  const deadline = Date.now() + 30_000

  while (port === null && Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    output += decoder.decode(value)
    const match = output.match(/listening http:\/\/[^:]+:(\d+)/)
    if (match) port = Number(match[1])
  }

  if (port === null) {
    proc.kill()
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`managed server did not start:\n${output}\n${stderr}`)
  }

  // Keep draining stdout so the child never blocks on a full pipe.
  void (async () => {
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  })()

  let exit: Promise<number> | null = null
  return {
    port,
    stop: async () => {
      if (exit) return exit
      proc.kill('SIGTERM')
      exit = proc.exited
      return exit
    },
  }
}

/**
 * Polls the managed server's health until it reports ready.
 * @param base The server origin.
 * @returns The ready health payload.
 */
const waitForManagedHealth = async (base: string): Promise<{ status?: string, version?: string }> => {
  const deadline = Date.now() + 60_000
  let last: { status?: string, version?: string } = {}

  while (Date.now() < deadline) {
    const response = await fetch(`${base}/health`)
    last = await response.json() as { status?: string, version?: string }
    if (response.status === 200 && last.status === 'ok') return last
    await Bun.sleep(100)
  }

  throw new Error(`managed health never became ready: ${JSON.stringify(last)}`)
}

/**
 * Regression test for the external React/server consumer contract.
 *
 * Installs Basis from a tag-shaped Git surface and proves that `basis/react`
 * and `basis/server` typecheck, run, bundle, and serve in managed-production
 * mode without Basis-monorepo `paths` aliases or direct
 * `node_modules/basis/libraries/*` imports. The fixture has no workspace
 * symlinks, so it catches dependency/peer-resolution mistakes that workspace
 * hoisting would otherwise hide. It declares the same React range as Basis, so
 * the exact-one-runtime assertions are a real deduplication test.
 */
const main = async (): Promise<void> => {
  const repoRoot = join(import.meta.dir, '..', '..')
  const workspace = makeTempDir('basis-react-')
  const source = join(workspace, 'basis-source')
  const tag = 'basis-react-runtime-e2e'
  const { path } = makeToolPath(workspace)
  const env = { PATH: path }

  try {
    run(['git', 'clone', '--quiet', '--local', '--no-hardlinks', repoRoot, source], workspace, env)
    // Force a lightweight tag so the fixture works even on hosts that enable
    // global tag signing (which would otherwise require a tag message).
    run(['git', '-c', 'tag.gpgsign=false', 'tag', tag], source, env)
    const spec = `git+file://${source}#${tag}`

    const app = join(workspace, 'app')
    initReactApp(app, spec)
    run(['bun', 'install'], app, env)

    assertNodeFree(app, env)
    assertDoctorOk(app, env)
    assertNoBasisRuntimeHacks(app)

    /*
     * One documented React contract. Because the app declares the same React
     * range as Basis, a real React consumer must deduplicate with Basis into a
     * single runtime instead of installing a copy per package.
     */
    assert(findInstalledInstances(app, 'react').length === 1, 'exactly one React runtime is installed')
    assert(findInstalledInstances(app, 'react-dom').length === 1, 'exactly one ReactDOM runtime is installed')

    /*
     * `basis typecheck` compiles the consumer source through the shipped React
     * preset, so it proves the runtime source graph is self-contained.
     */
    const basisBin = join(app, 'node_modules', '.bin', 'basis')
    run(['bun', basisBin, 'typecheck'], app, env)

    /*
     * Executing the fixture proves runtime module resolution (React, the server,
     * and their transitive dependencies) without workspace symlinks.
     */
    const output = run(['bun', 'src/runtime.tsx'], app, env)
    assert(output.includes('runtime-ok'), 'react/server runtime executed')

    // Bundling proves the source resolves through Bun's bundler too.
    run(['bun', 'build', 'src/runtime.tsx', '--outdir', 'dist'], app, env)

    // Starting the managed server proves the production surface end to end.
    const server = await startManagedServer(app, env)
    const base = `http://127.0.0.1:${server.port}`

    const health = await waitForManagedHealth(base)
    assert(health.version === 'consumer-version', 'managed /health reports the release version')

    const html = await fetch(base).then(response => response.text())
    assert(html.includes('/scripts/index.js'), 'managed server serves the SPA shell')
    assert(
      !html.includes('/modules/') && !html.includes('hmr.js'),
      'production omits development machinery',
    )
    assert((await fetch(`${base}/scripts/index.js`)).status === 200, 'managed server serves the built entrypoint')
    assert(await server.stop() === 0, 'managed server shuts down cleanly')

    process.stdout.write(`[basis] consumer react runtime: ok (${workspace})\n`)
  } finally {
    if (process.env.BASIS_KEEP_FIXTURE === '1') {
      process.stdout.write(`[basis] fixture kept at ${workspace}\n`)
    } else {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
}

await main()
