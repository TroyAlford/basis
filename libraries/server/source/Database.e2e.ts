import { Logger } from 'basis/logger'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from './Database'
import { Server } from './Server'

/*
 * Real disposable PostgreSQL lifecycle. The database suite is an e2e lane
 * because it owns a Docker container; it never replaces the real boundary with
 * a mock.
 */

const IMAGE = 'postgres:17-alpine'
const USER = 'basis'
const PASSWORD = 'basis'
const NAME = 'basis'
const PORT = 5432
const READY_TIMEOUT_MS = 60_000
const READY_POLL_MS = 100

/** Docker command result. */
interface DockerResult {
  /** Process exit code. */
  code: number,
  /** Standard error. */
  stderr: string,
  /** Standard output. */
  stdout: string,
}

/**
 * Run a Docker CLI command and capture its output.
 * @param args - Arguments after `docker`.
 * @returns The exit code and captured output.
 */
function docker(args: string[]): DockerResult {
  const process = Bun.spawnSync(['docker', ...args], { stderr: 'pipe', stdout: 'pipe' })
  const decoder = new TextDecoder()
  return {
    code: process.exitCode ?? -1,
    stderr: decoder.decode(process.stderr),
    stdout: decoder.decode(process.stdout),
  }
}

/**
 * Extract the published localhost port from `docker port` output.
 * @param output - Output such as `127.0.0.1:49152`.
 * @returns The port, or null when no port was published.
 */
function publishedPort(output: string): number | null {
  const match = /:(\d+)\s*$/m.exec(output.trim())
  return match ? Number(match[1]) : null
}

let container: string | null = null
let databaseUrl = ''

beforeAll(async () => {
  const run = docker([
    'run', '-d', '--rm', '--pull', 'missing',
    '-e', `POSTGRES_USER=${USER}`,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e', `POSTGRES_DB=${NAME}`,
    '-p', `127.0.0.1::${PORT}`,
    IMAGE,
  ])
  if (run.code !== 0) {
    throw new Error(`PostgreSQL container failed to start:\n${run.stderr.trim()}`)
  }
  container = run.stdout.trim()

  const deadline = Date.now() + READY_TIMEOUT_MS
  let ready = false
  while (Date.now() < deadline) {
    if (docker(['exec', container, 'pg_isready', '-U', USER, '-d', NAME]).code === 0) {
      ready = true
      break
    }
    await Bun.sleep(READY_POLL_MS)
  }

  if (!ready) {
    const logs = docker(['logs', container])
    throw new Error(`PostgreSQL did not become ready within ${READY_TIMEOUT_MS}ms:\n${logs.stdout}${logs.stderr}`)
  }

  const port = publishedPort(docker(['port', container, `${PORT}/tcp`]).stdout)
  if (port === null) throw new Error('PostgreSQL did not publish its port')
  databaseUrl = `postgres://${USER}:${PASSWORD}@127.0.0.1:${port}/${NAME}`
}, 120_000)

afterAll(async () => {
  if (container !== null) docker(['rm', '-f', container])
  container = null
})

describe('Database', () => {
  test('connects to a real PostgreSQL server', async () => {
    const database = new Database({ connectionTimeout: 5, max: 2, url: databaseUrl })

    try {
      await database.connect()
      expect(database.closed).toBe(false)
    } finally {
      await database.close()
    }

    expect(database.closed).toBe(true)
  })

  test('reports a connection failure', async () => {
    const database = new Database({
      connectionTimeout: 1,
      url: 'postgres://basis:basis@127.0.0.1:1/basis',
    })

    try {
      await expect(database.connect()).rejects.toThrow()
    } finally {
      await database.close()
    }
  })
})

describe('Server database lifecycle', () => {
  test('owns its pool and closes it on shutdown', async () => {
    const server = new Server()
      .database({ connectionTimeout: 5, url: databaseUrl })
      .start({ development: true, logger: new Logger({ silent: true }), port: 0 })

    const database = server.db
    expect(database).toBeDefined()
    await database?.connect()

    server.stop()
    await server.shutdown()

    expect(database?.closed).toBe(true)
    await expect(database?.connect()).rejects.toThrow('Database is closed')
  })

  test('surfaces a connection failure through the owned pool', async () => {
    const server = new Server()
      .database({
        connectionTimeout: 1,
        url: 'postgres://basis:basis@127.0.0.1:1/basis',
      })
      .start({ development: true, logger: new Logger({ silent: true }), port: 0 })

    try {
      await expect(server.db?.connect()).rejects.toThrow()
    } finally {
      await server.shutdown()
    }

    expect(server.db?.closed).toBe(true)
  })
})
