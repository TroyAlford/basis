import { DatabaseRelease, Graph, loadRelease } from 'basis/server'
import { directories } from 'basis/utilities'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { removeService } from '../libraries/server/testing/DatabaseFixture'

/** Generated Graph snapshot used by the repository migration gate. */
const GRAPH = 'graph.json'
/** Application migration convention. */
const MIGRATIONS = 'migrations'

/**
 * Read one file from a Git revision.
 * @param ref - Git revision.
 * @param path - Repository-relative path.
 * @returns File content, or null when absent.
 */
function gitFile(ref: string, path: string): string | null {
  const result = Bun.spawnSync(['git', 'show', `${ref}:${path}`], {
    cwd: process.cwd(),
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) return null
  return result.stdout.toString()
}

/**
 * List files beneath one repository path at a Git revision.
 * @param ref - Git revision.
 * @param path - Repository-relative directory.
 * @returns Repository-relative paths.
 */
function gitFiles(ref: string, path: string): string[] {
  const result = Bun.spawnSync(['git', 'ls-tree', '-r', '--name-only', ref, '--', path], {
    cwd: process.cwd(),
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) return []
  return result.stdout.toString().split('\n').filter(Boolean)
}

/**
 * Materialize a directory from one Git revision.
 * @param ref - Git revision.
 * @param source - Repository-relative source directory.
 * @param target - Host target directory.
 */
async function materialize(ref: string, source: string, target: string): Promise<void> {
  for (const path of gitFiles(ref, source)) {
    const content = gitFile(ref, path)
    if (content === null) continue
    const destination = join(target, relative(source, path))
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
  }
}

/**
 * Resolve one named CLI option.
 * @param name - Option name.
 * @param fallback - Value used when omitted.
 * @returns Selected value.
 */
function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  return process.argv[index + 1] || fallback
}

/**
 * Resolve the base Git revision.
 * @returns Base Git revision.
 */
function baseRef(): string {
  return option('--base', 'origin/main')
}

/**
 * Load a Graph snapshot.
 * @param source - JSON snapshot.
 * @returns Validated Graph.
 */
function loadSnapshot(source: string): Graph {
  return new Graph(JSON.parse(source) as ConstructorParameters<typeof Graph>[0])
}

/**
 * Run the checked-in base→head migration proof against real managed PostgreSQL.
 * @returns Process exit code.
 */
async function main(): Promise<number> {
  const base = baseRef()
  const root = process.cwd()
  const gate = directories('migration-gate')
  await gate.ensure()
  const sandbox = await mkdtemp(join(gate.path, 'run-'))
  const install = join(sandbox, 'postgres')
  await mkdir(install, { recursive: true })
  const baseMigrations = join(sandbox, 'base-migrations')
  let baseGraph: Graph | null = null
  try {
    const baseGraphSource = gitFile(base, GRAPH)
    const baseManifest = gitFile(base, join(MIGRATIONS, 'manifest.json'))
    if (baseGraphSource !== null) {
      baseGraph = loadSnapshot(baseGraphSource)
      await materialize(base, MIGRATIONS, baseMigrations)
    } else if (baseManifest !== null) {
      throw new Error('Base revision has migrations but no graph.json snapshot')
    }
    const headGraph = loadSnapshot(await readFile(join(root, GRAPH), 'utf8'))
    const headRelease = await loadRelease(join(root, MIGRATIONS), headGraph)
    process.chdir(install)
    if (baseGraph) {
      await new DatabaseRelease({
        graph: baseGraph,
        migrations: baseMigrations,
      }).apply()
    }
    const head = new DatabaseRelease({
      graph: headGraph,
      migrations: join(root, MIGRATIONS),
    })
    const result = await head.apply()
    const plan = await head.plan()
    if (!plan.upToDate) throw new Error('Head migrations did not reach the proposed Graph')
    process.stdout.write(
      `[basis] migrations: base=${baseGraph ? 'snapshot' : 'bootstrap'} ` +
      `version=${headRelease.manifest.version} applied=${result.applied.length} ` +
      `backup=${result.backup ? 'yes' : 'no'}\n`,
    )
    return 0
  } finally {
    process.chdir(root)
    removeService(install)
    await rm(sandbox, { force: true, recursive: true })
  }
}

process.exit(await main())
