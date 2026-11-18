import { Logger } from 'basis/logger'
import type { Identity } from 'basis/oauth'
import { HttpVerb } from 'basis/server'
import { tempDirectory } from 'basis/testing'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(60_000)
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { installSchema } from '../testing/Schema'
import { createDatabase, openAdmin } from './Database'
import { Action } from './Graph'
import { Graph } from './Graph'
import type { MigrationArtifact } from './Schema'
import { installBasis } from './Schema'
import { Server } from './Server'

const silent = new Logger({ silent: true })
const repoRoot = join(import.meta.dir, '..', '..', '..')
const application = join(repoRoot, 'testing', 'server', 'ContextArticles.tsx')

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: 'String' }], name: 'User' },
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
      ],
      name: 'Article',
      security: {
        [Action.Read]: [{ where: 'owner = $me' }],
        [Action.Create]: { role: 'admin' },
      },
    },
  ],
})

interface Context {
  articles: { title: string }[],
}

interface Fixture {
  alice: string,
  base: string,
  bob: string,
  server: Server<Context>,
  stop: () => Promise<void>,
}

/**
 * Give the temporary install a real node_modules directory. Symlinking the whole directory
 * breaks Basis's relative self-link when the install is outside the repository.
 * @param install - Temporary installation root.
 * @returns A promise that settles after the links are created.
 */
async function linkDependencies(install: string): Promise<void> {
  const modules = join(install, 'node_modules')
  const source = join(repoRoot, 'node_modules')
  await mkdir(modules, { recursive: true })
  for (const entry of await readdir(source)) {
    if (entry === 'basis') continue
    await symlink(join(source, entry), join(modules, entry), 'dir')
  }
  await symlink(repoRoot, join(modules, 'basis'), 'dir')
}

/**
 * Start a Graph-backed server whose context loader reads RLS-protected data.
 * @param install - Temporary installation root.
 * @param loads - Mutable counter for loader invocations.
 * @param loads.count - Number of loader invocations observed.
 * @returns The server fixture.
 */
async function start(install: string, loads: { count: number }): Promise<Fixture> {
  await linkDependencies(install)

  const previous = process.cwd()
  process.chdir(install)
  const database = createDatabase({ authorization: true, entities: graph.definitions })
  let artifact: MigrationArtifact
  try {
    await database.connect()
    const admin = await openAdmin(database)
    try {
      await installBasis(admin.sql)
      artifact = await installSchema(admin.sql, graph, {
        appRole: 'basis_app',
        schema: 'public',
        superuser: true,
        version: `context-${randomUUID()}`,
      })
    } finally {
      await admin.close()
    }
  } finally {
    await database.close()
  }

  const server = new Server<Context>()
    .graph(graph)
    .database()
    .root(install)
    .migration(artifact)
  server.context(async () => {
    loads.count += 1
    const articles = await server.db.query<{ title: string }>('Article', { fields: ['title'] })
      .catch(() => [])
    return { context: { articles } }
  })
  server.main(application)
    .api([HttpVerb.Get], 'context', (_params, context) => Response.json(context.context))
  server.identity({ get: request => request.headers.get('x-actor') } as unknown as Identity)
  server.start({ hostname: '127.0.0.1', logger: silent, port: 0 })
  process.chdir(previous)

  await server.ready()

  const authorization = server.auth
  if (!authorization) throw new Error('authorization did not initialize')
  const adminUser = await authorization.bootstrap({
    displayName: 'Admin',
    email: 'admin@example.com',
    provider: 'test',
    subject: 'admin',
  })
  if (!adminUser.userId) throw new Error('admin bootstrap failed')
  const alice = await authorization.enrollIdentity('test', 'alice', { email: 'alice@example.com' })
  const bob = await authorization.enrollIdentity('test', 'bob', { email: 'bob@example.com' })
  if (!alice || !bob) throw new Error('identity enrollment failed')

  const adminConnection = await openAdmin(server.db)
  try {
    for (const [owner, title] of [[alice, 'Alice article'], [bob, 'Bob article']] as const) {
      const id = randomUUID()
      await adminConnection.sql.begin(async tx => {
        await tx`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${id}, ${title}, 'Article')
        `
        await tx`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${id}, ${title}, ${owner})
        `
      })
    }
  } finally {
    await adminConnection.close()
  }

  return {
    alice,
    base: `http://127.0.0.1:${server.port}`,
    bob,
    server,
    stop: async () => { await server.shutdown() },
  }
}

/**
 * Request one route as an actor.
 * @param fixture - The running fixture.
 * @param path - The route to request.
 * @param actor - Verified actor id, or null for anonymous.
 * @returns The response.
 */
const request = (fixture: Fixture, path: string, actor: string | null): Promise<Response> => (
  Bun.fetch(`${fixture.base}${path}`, {
    headers: actor ? { 'x-actor': actor } : {},
  })
)

describe('request context and RLS', () => {
  test('loads context under the verified actor for SSR and API handlers', async () => {
    const install = tempDirectory('basis-context-rls-')
    const loads = { count: 0 }
    const fixture = await start(install, loads)

    try {
      const aliceHtml = await request(fixture, '/', fixture.alice).then(response => response.text())
      expect(aliceHtml).toContain('Alice article')
      expect(aliceHtml).not.toContain('Bob article')
      expect(loads.count).toBe(1)

      const aliceApi = await fixture.server.handle(new Request(`${fixture.base}/api/context`, {
        headers: { 'x-actor': fixture.alice },
      }))
      expect(await aliceApi?.json()).toEqual({ articles: [{ title: 'Alice article' }] })
      expect(loads.count).toBe(2)

      const bobHtml = await request(fixture, '/', fixture.bob).then(response => response.text())
      expect(bobHtml).toContain('Bob article')
      expect(bobHtml).not.toContain('Alice article')

      const anonymous = await request(fixture, '/', null).then(response => response.text())
      expect(anonymous).not.toContain('Alice article')
      expect(anonymous).not.toContain('Bob article')
    } finally {
      await fixture.stop()
      await rm(install, { force: true, recursive: true })
    }
  }, 30_000)

  test('does not leak context between concurrent actors', async () => {
    const install = tempDirectory('basis-context-concurrent-')
    const fixture = await start(install, { count: 0 })

    try {
      const [alice, bob, anonymous] = await Promise.all([
        request(fixture, '/', fixture.alice).then(response => response.text()),
        request(fixture, '/', fixture.bob).then(response => response.text()),
        request(fixture, '/', null).then(response => response.text()),
      ])

      expect(alice).toContain('Alice article')
      expect(alice).not.toContain('Bob article')
      expect(bob).toContain('Bob article')
      expect(bob).not.toContain('Alice article')
      expect(anonymous).not.toContain('Alice article')
      expect(anonymous).not.toContain('Bob article')
    } finally {
      await fixture.stop()
      await rm(install, { force: true, recursive: true })
    }
  }, 30_000)
})
