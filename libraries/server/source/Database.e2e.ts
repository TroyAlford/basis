import { Logger } from 'basis/logger'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Server } from './Server'

/*
 * Real PostgreSQL lifecycle. The suite owns Docker containers through the
 * server capability; it never replaces the database boundary with a mock.
 */

const root = join(import.meta.dir, '..', '..', '..')
const USER = 'basis'
const DATABASE = 'basis'

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
  const child = Bun.spawnSync(['docker', ...args], { stderr: 'pipe', stdout: 'pipe' })
  const decoder = new TextDecoder()
  return {
    code: child.exitCode ?? -1,
    stderr: decoder.decode(child.stderr),
    stdout: decoder.decode(child.stdout),
  }
}

/**
 * Find the running managed container for an application scope.
 * @param name - The managed database scope.
 * @returns The container id, or an empty string.
 */
function container(name: string): string {
  return docker(['ps', '-q', '--filter', `label=basis.database=${name}`]).stdout.trim().split('\n')[0] ?? ''
}

/**
 * Remove the durable volume for an application scope.
 * @param name - The managed database scope.
 */
function removeVolume(name: string): void {
  const volume = docker(['volume', 'ls', '-q', '--filter', `label=basis.database=${name}`]).stdout.trim()
  if (volume) docker(['volume', 'rm', '-f', volume])
}

/**
 * Build a server with a silent logger.
 * @param server - The configured server.
 * @returns The started server.
 */
function start(server: Server): Server {
  return server.start({ development: true, hostname: '127.0.0.1', logger: new Logger({ silent: true }), port: 0 })
}

/**
 * Read the current health payload.
 * @param server - The started server.
 * @returns The health status and optional error.
 */
async function health(server: Server): Promise<{ error?: string, status?: string }> {
  const response = await server.handle(new Request('http://localhost/api/health'))
  if (!response) throw new Error('health route did not respond')
  return await response.json() as { error?: string, status?: string }
}

describe('Server database lifecycle', () => {
  test('persists managed data across a real restart and closes its pool', async () => {
    const name = `basis-e2e-${randomUUID()}`

    try {
      const first = start(new Server().database({ name }))
      try {
        await first.ready()
        expect(first.db.closed).toBe(false)
        await first.db.connect()

        const id = container(name)
        expect(id).not.toBe('')
        const write = docker([
          'exec', id, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', DATABASE,
          '-c', 'create table basis_restart_probe (id integer primary key); insert into basis_restart_probe values (1)',
        ])
        expect(write.code).toBe(0)
      } finally {
        await first.shutdown()
      }

      expect(first.db.closed).toBe(true)
      await expect(first.db.connect()).rejects.toThrow('Database is closed')

      const second = start(new Server().database({ name }))
      try {
        await second.ready()
        const read = docker([
          'exec', container(name), 'psql',
          '-U', USER, '-d', DATABASE, '-tAc', 'select count(*) from basis_restart_probe',
        ])
        expect(read.code).toBe(0)
        expect(read.stdout.trim()).toBe('1')
      } finally {
        await second.shutdown()
      }
    } finally {
      removeVolume(name)
    }
  }, 120_000)

  test('does not leak a container when shutdown races startup', async () => {
    const name = `basis-e2e-race-${randomUUID()}`

    try {
      const server = start(new Server().database({ name }))
      await server.shutdown()
      expect(container(name)).toBe('')
    } finally {
      removeVolume(name)
    }
  }, 60_000)

  test('reports unhealthy when an external PostgreSQL connection fails', async () => {
    const server = start(new Server().database({
      connectionTimeout: 1,
      url: 'postgres://basis:basis@127.0.0.1:1/basis',
    }))

    try {
      await expect(server.ready()).rejects.toThrow()
      const result = await health(server)
      expect(result.status).toBe('error')
      expect(result.error).toBeDefined()
    } finally {
      await server.shutdown()
    }
  }, 30_000)

  test('uses a null capability when no database is configured', async () => {
    const server = start(new Server())

    try {
      await expect(server.db.connect()).rejects.toThrow('No database is configured for this server')
    } finally {
      await server.shutdown()
    }

    expect(server.db.closed).toBe(true)
  }, 30_000)

  test('reports unhealthy when a managed database needs Docker but Docker is unavailable', async () => {
    const script = `
      import { Logger } from 'basis/logger'
      import { Server } from 'basis/server'

      const server = new Server().database().start({
        development: true,
        hostname: '127.0.0.1',
        logger: new Logger({ silent: true }),
        port: 0,
      })
      const deadline = Date.now() + 15_000
      let body = null
      while (Date.now() < deadline) {
        const response = await Bun.fetch(\`http://127.0.0.1:\${server.port}/api/health\`)
        body = await response.json()
        if (body.status === 'error') break
        await Bun.sleep(50)
      }
      console.log(JSON.stringify(body))
      await server.shutdown()
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
      cwd: root,
      env: { ...process.env, PATH: '/nonexistent' },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(code).toBe(0)
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { error?: string, status?: string }
    expect(result.status).toBe('error')
    expect(result.error).toContain('requires Docker')
  }, 60_000)
})
