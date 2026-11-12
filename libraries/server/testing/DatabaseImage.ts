import { runAsync } from 'basis/configuration'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SEED_DIRECTORY, seedImage } from '../../../testing/database/seed/image'
import { managedDatabaseIdentity } from '../source/ManagedPostgresService'

/** The seed image's data directory. */
const SEED_DATA = '/var/lib/postgresql/data'

/**
 * Ensure the immutable seeded PostgreSQL image exists locally.
 *
 * The image is pulled when published and built only when the committed fixture
 * inputs changed and no registry copy exists for that checksum.
 * @param image - Immutable image reference.
 * @returns The resolved image reference.
 */
export async function ensureSeedImage(image = seedImage()): Promise<string> {
  const local = await runAsync('docker', ['image', 'inspect', image])
  if (local.exitCode === 0) return image
  const pulled = await runAsync('docker', ['pull', image])
  if (pulled.exitCode === 0) return image
  const built = await runAsync('docker', [
    'build',
    '--file',
    join(SEED_DIRECTORY, 'Dockerfile'),
    '--tag',
    image,
    SEED_DIRECTORY,
  ])
  if (built.exitCode !== 0) {
    throw new Error(`Seeded PostgreSQL fixture could not be pulled or built: ${built.stderr.trim()}`)
  }
  return image
}

/**
 * Ensure the fixture's host-owned credential file exists.
 *
 * The seeded image trusts loopback connections, so this credential only
 * satisfies the managed service's host contract; it is not a database password.
 * @param install - Fixture installation root.
 */
function ensureSeedCredential(install: string): void {
  const directory = join(install, '.basis', 'database')
  mkdirSync(directory, { mode: 0o700, recursive: true })
  const file = join(directory, 'password')
  if (!existsSync(file)) writeFileSync(file, randomUUID(), { mode: 0o600 })
}

/**
 * Prepare the one data volume for the seeded ordinary-database container.
 *
 * The image already contains the seeded data. This copies it into the managed
 * volume once, keyed by the immutable image tag, so later runs attach to the
 * same volume instead of rebuilding or reloading fixtures.
 * @param install - Fixture installation root.
 * @param image - Immutable seeded image reference.
 */
export async function prepareSeedVolume(install: string, image = seedImage()): Promise<void> {
  ensureSeedCredential(install)
  const identity = managedDatabaseIdentity(install)
  const volume = `basis-postgres-${identity}`
  const existing = await runAsync('docker', ['volume', 'ls', '-q', '--filter', `name=^${volume}$`])
  if (existing.lines.length > 0) {
    const labels = await runAsync('docker', ['volume', 'inspect', '--format', '{{json .Labels}}', volume])
    let seeded: string | undefined
    try {
      const parsed = JSON.parse(labels.stdout.trim()) as Record<string, string> | null
      seeded = parsed?.['basis.seed']
    } catch {
      seeded = undefined
    }
    if (seeded === image) return
    const removed = await runAsync('docker', ['volume', 'rm', '-f', volume])
    if (removed.exitCode !== 0) {
      throw new Error(`Stale seeded database volume could not be replaced: ${removed.stderr.trim()}`)
    }
  }

  const created = await runAsync('docker', [
    'volume',
    'create',
    '--label', `basis.database=${identity}`,
    '--label', `basis.install=${install}`,
    '--label', `basis.seed=${image}`,
    volume,
  ])
  if (created.exitCode !== 0) {
    throw new Error(`Seeded database volume failed to start: ${created.stderr.trim()}`)
  }
  const copied = await runAsync('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    '-v', `${volume}:/to`,
    image,
    '-c',
    `rm -rf /to/* /to/.[!.]* 2>/dev/null || true; cp -a ${SEED_DATA}/. /to/`,
  ])
  if (copied.exitCode !== 0) {
    throw new Error(`Seeded database volume could not be populated: ${copied.stderr.trim()}`)
  }
}
