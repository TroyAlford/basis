import { runAsync } from 'basis/configuration'
import { SQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { SEED_DIRECTORY, SEED_SCHEMA, seedImage } from '../../../testing/database/seed/image'

/** A connection to the prebuilt PostgreSQL fixture image. */
export interface SeedDatabase {
  /** SQL client scoped to the seeded schema. */
  readonly sql: SQL,
}

/** Readiness polling interval. */
const READY_POLL_MS = 100
/** Maximum time to wait for the prebuilt image to accept connections. */
const READY_TIMEOUT_MS = 30_000

/**
 * Start the prebuilt PostgreSQL fixture image and run one callback against it.
 *
 * The image already contains the deterministic 500,000-row dataset. Tests pull
 * or reuse that immutable image; they never recreate the dataset.
 * @param callback - Work performed against the seeded database.
 * @returns The callback result.
 */
export async function withSeedDatabase<T>(
  callback: (database: SeedDatabase) => Promise<T>,
): Promise<T> {
  const image = seedImage()
  await ensureImage(image)
  const name = `basis-seed-${randomUUID()}`
  const started = await runAsync('docker', [
    'run',
    '-d',
    '--pull',
    'missing',
    '--name',
    name,
    '-p',
    '127.0.0.1::5432',
    image,
  ])
  if (started.exitCode !== 0) {
    throw new Error(`Prebuilt PostgreSQL fixture failed to start: ${started.stderr.trim()}`)
  }

  let sql: SQL | null = null
  try {
    const port = await publishedPort(name)
    await waitUntilReady(name)
    sql = new SQL({ max: 1, url: `postgres://basis@127.0.0.1:${port}/basis` })
    await sql.unsafe(`set search_path to "${SEED_SCHEMA}"`).simple()
    return await callback({ sql })
  } finally {
    await sql?.close()
    await runAsync('docker', ['rm', '-f', name])
  }
}

/**
 * Pull the immutable image or build the committed seed locally when no cache or
 * registry copy exists. Once present, later runs reuse the same image.
 * @param image - Immutable image reference.
 */
async function ensureImage(image: string): Promise<void> {
  const local = await runAsync('docker', ['image', 'inspect', image])
  if (local.exitCode === 0) return
  const pulled = await runAsync('docker', ['pull', image])
  if (pulled.exitCode === 0) return
  const built = await runAsync('docker', [
    'build',
    '--file',
    join(SEED_DIRECTORY, 'Dockerfile'),
    '--tag',
    image,
    SEED_DIRECTORY,
  ])
  if (built.exitCode !== 0) {
    throw new Error(`Prebuilt PostgreSQL fixture could not be pulled or built: ${built.stderr.trim()}`)
  }
}

/**
 * Read the Docker-published loopback port for the fixture.
 * @param name - Container name.
 * @returns Published host port.
 */
async function publishedPort(name: string): Promise<number> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await runAsync('docker', ['port', name, '5432/tcp'])
    const match = /:(\d+)\s*$/m.exec(result.stdout.trim())
    if (match?.[1]) return Number(match[1])
    await Bun.sleep(READY_POLL_MS)
  }
  throw new Error('Prebuilt PostgreSQL fixture did not publish a loopback port')
}

/**
 * Wait until the prebuilt fixture accepts connections.
 * @param name - Container name.
 */
async function waitUntilReady(name: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const result = await runAsync('docker', [
      'exec',
      name,
      'pg_isready',
      '-U',
      'basis',
      '-d',
      'basis',
    ])
    if (result.exitCode === 0) return
    await Bun.sleep(READY_POLL_MS)
  }
  throw new Error('Prebuilt PostgreSQL fixture did not become ready')
}
