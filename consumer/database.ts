import type { Graph, MigrationArtifact } from 'basis/server'
import { DatabaseRelease, loadRelease, ManagedPostgresOperations } from 'basis/server'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Database operator command names. */
enum DatabaseCommand {
  Backup = 'backup',
  Plan = 'plan',
  Release = 'release',
  Restore = 'restore',
  Rollback = 'rollback',
  Upgrade = 'upgrade',
}

/** One resolved application database context. */
interface DatabaseContext {
  /** Current reviewed migration artifact. */
  readonly artifact: MigrationArtifact,
  /** Application physical model. */
  readonly graph: Graph,
  /** Checked-in migrations directory. */
  readonly migrations: string,
}

/**
 * Print the database command usage.
 */
function usage(): void {
  process.stderr.write([
    'usage: basis db <plan|release|backup|restore|upgrade|rollback>',
    '  restore <archive> [--image <image>]',
    '  upgrade <image>',
    '  rollback <archive> [--image <image>]',
  ].join('\n') + '\n')
}

/**
 * Read one optional `--image` value.
 * @param args - Command arguments after the database subcommand.
 * @returns The image, when supplied.
 */
function imageOption(args: readonly string[]): string | undefined {
  const index = args.indexOf('--image')
  if (index === -1) return undefined
  const image = args[index + 1]
  if (image === undefined || image.startsWith('--')) {
    throw new Error('--image requires a value')
  }
  return image
}

/**
 * Resolve the application Graph and current reviewed migration from the working directory.
 * @returns The database context.
 */
async function loadContext(): Promise<DatabaseContext> {
  const root = process.cwd()
  const graphPath = join(root, 'graph.ts')
  if (!existsSync(graphPath)) {
    throw new Error(`Expected a Basis application graph at ${graphPath}`)
  }
  const module = await import(pathToFileURL(graphPath).href) as { default?: unknown, graph?: unknown }
  const graph = module.default ?? module.graph
  if (
    typeof graph !== 'object'
    || graph === null
    || typeof (graph as Graph).physicalSchema !== 'function'
  ) {
    throw new Error(`Expected ${graphPath} to default-export or export a Basis Graph`)
  }
  const migrations = join(root, 'migrations')
  const release = await loadRelease(migrations, graph as Graph)
  const artifact = release.migrations.at(-1)
  if (artifact === undefined) throw new Error('No reviewed database migrations exist')
  return { artifact, graph: graph as Graph, migrations }
}

/**
 * Run one host database operator command.
 * @param args - Arguments after `basis db`.
 * @returns The process exit code.
 */
export async function runDatabase(args: readonly string[]): Promise<number> {
  const [rawCommand, ...rest] = args
  const command = Object.values(DatabaseCommand).find(candidate => candidate === rawCommand)
  if (command === undefined) {
    usage()
    return 1
  }

  try {
    let archive: string | undefined
    let image: string | undefined
    if (command === DatabaseCommand.Restore || command === DatabaseCommand.Rollback) {
      archive = rest[0]
      if (archive === undefined || archive.startsWith('--')) {
        throw new Error(`db ${command} requires an archive path`)
      }
      image = imageOption(rest)
    } else if (command === DatabaseCommand.Upgrade) {
      image = rest[0]
      if (image === undefined || image.startsWith('--')) {
        throw new Error('db upgrade requires a PostgreSQL image')
      }
    } else if (rest.length > 0) {
      throw new Error(`db ${command} does not accept arguments`)
    }

    const context = await loadContext()
    const release = new DatabaseRelease({
      graph: context.graph,
      migrations: context.migrations,
    })
    const operations = new ManagedPostgresOperations({ artifact: context.artifact })
    const result = await (() => {
      if (command === DatabaseCommand.Plan) return release.plan()
      if (command === DatabaseCommand.Release) return release.apply()
      if (command === DatabaseCommand.Backup) return operations.backup()
      if (command === DatabaseCommand.Restore) return operations.restore(archive as string, { image })
      if (command === DatabaseCommand.Upgrade) return operations.upgrade(image as string)
      return operations.rollback(archive as string, image)
    })()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
