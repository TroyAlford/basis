import { DatabaseRelease, loadRelease } from 'basis/server'
import { Graph } from 'basis/server'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { removeService } from '../libraries/server/testing/DatabaseFixture'

/** Fixture graph used by the repository migration gate. */
const GRAPH = 'testing/release/graph.ts'
/** Fixture migrations used by the repository migration gate. */
const MIGRATIONS = 'testing/release/migrations'

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
 * Resolve one named CLI option, environment fallback, or default.
 * @param name - Option name.
 * @param environment - Environment variable name.
 * @param fallback - Value used when both are omitted.
 * @returns Selected value.
 */
function option(name: string, environment: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index >= 0) return process.argv[index + 1] || fallback
  return process.env[environment] || fallback
}

/**
 * Resolve the base Git revision.
 * @returns Base Git revision.
 */
function baseRef(): string {
  return option('--base', 'BASIS_MIGRATION_BASE', 'origin/main')
}

/**
 * Load a Graph module from a file.
 * @param file - Absolute module path.
 * @returns The default Graph export.
 */
async function loadGraph(file: string): Promise<Graph> {
  const module = await import(`${pathToFileURL(file).href}?gate=${Date.now()}`) as {
    default?: unknown,
    graph?: unknown,
  }
  const value = module.graph ?? module.default
  if (!(value instanceof Graph)) {
    throw new Error(`${file} must export a Graph as \`graph\``)
  }
  return value
}

/**
 * Run the checked-in base→head migration proof against real managed PostgreSQL.
 * @returns Process exit code.
 */
async function main(): Promise<number> {
  const base = baseRef()
  const graphPath = option('--graph', 'BASIS_MIGRATION_GRAPH', GRAPH)
  const migrationsPath = option('--migrations', 'BASIS_MIGRATION_DIR', MIGRATIONS)
  const root = process.cwd()
  await mkdir(join(root, '.basis'), { mode: 0o700, recursive: true })
  const sandbox = await mkdtemp(join(root, '.basis', 'migration-gate-'))
  const install = join(sandbox, 'postgres')
  const baseMigrations = join(sandbox, 'base-migrations')
  let baseGraph: Graph | null = null
  try {
    const baseGraphSource = gitFile(base, graphPath)
    if (baseGraphSource !== null) {
      const file = join(sandbox, 'base-graph.ts')
      await writeFile(file, baseGraphSource)
      baseGraph = await loadGraph(file)
      await materialize(base, migrationsPath, baseMigrations)
    }
    const headGraphSource = await readFile(join(root, graphPath), 'utf8')
    const headGraphFile = join(sandbox, 'head-graph.ts')
    await writeFile(headGraphFile, headGraphSource)
    const headGraph = await loadGraph(headGraphFile)
    const headRelease = await loadRelease(join(root, migrationsPath), headGraph)
    const head = new DatabaseRelease({
      graph: headGraph,
      installation: install,
      migrations: join(root, migrationsPath),
    })
    if (baseGraph) {
      await new DatabaseRelease({
        graph: baseGraph,
        installation: install,
        migrations: baseMigrations,
      }).apply()
    }
    const result = await head.apply()
    const plan = await head.plan()
    if (!plan.upToDate) throw new Error('Head migrations did not reach the proposed Graph')
    process.stdout.write(
      `[basis] migrations: base=${baseGraph ? 'loaded' : 'none'} ` +
      `version=${headRelease.manifest.version} applied=${result.applied.length} ` +
      `backup=${result.backup ? 'yes' : 'no'}\n`,
    )
    return 0
  } finally {
    removeService(install)
    await rm(sandbox, { force: true, recursive: true })
  }
}

process.exit(await main())
