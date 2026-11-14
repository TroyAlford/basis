import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { runAsActor } from './ActorContext'
import { openAdmin } from './Database'
import { Graph } from './Graph'
import { MutationError } from './Mutation'
import { Server } from './Server'

const silent = new Logger({ silent: true })

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: 'String' }], name: 'User' },
    {
      fields: [
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'rank', type: 'Number' },
        { field: 'score', maximum: 10, minimum: 0, type: 'Number' },
        { field: 'title', type: 'String' },
      ],
      name: 'Article',
    },
  ],
  grants: [
    { action: 'create', role: 'admin', target: '*' },
    { action: 'delete', role: 'admin', target: '*' },
    { action: 'manage', role: 'admin', target: '*' },
    { action: 'read', role: 'admin', target: '*' },
    { action: 'update', role: 'admin', target: '*' },
    { action: 'read', role: 'public', target: 'Article' },
    { action: 'create', predicate: 'score >= 0', role: 'creator', target: 'Article' },
    { action: 'delete', predicate: 'rank < 40', role: 'deleter', target: 'Article' },
    { action: 'update', predicate: 'rank < 70', role: 'updater', target: 'Article' },
  ],
  roles: {
    creator: { name: 'Creator' },
    deleter: { name: 'Deleter' },
    updater: { name: 'Updater' },
  },
})

/**
 * Start one isolated authorization server with the mutation graph.
 * @param install - Temporary installation root.
 * @returns The started server.
 */
async function start(install: string): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .graph(graph)
    .database()
    .root(install)
  server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  try {
    await server.ready()
  } finally {
    process.chdir(previous)
  }
  const admin = await openAdmin(server.db)
  try {
    await installSchema(admin.sql, graph, {
      appRole: 'basis_app',
      schema: 'public',
      superuser: true,
      version: `mutation-authorization-${randomUUID()}`,
    })
  } finally {
    await admin.close()
  }
  return server
}

describe('Graph mutation authorization', () => {
  test('counts only mutable rows and never makes reads the write authority', async () => {
    const install = tempDirectory('basis-mutation-authorization-')
    const server = await start(install)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const asActor = <T>(actor: string | null, work: () => T): T => runAsActor({ id: actor }, work)
      const admin = await authorization.bootstrap({
        displayName: 'Admin',
        email: 'admin@example.com',
        provider: 'test',
        subject: 'admin',
      })
      if (!admin.userId) throw new Error('bootstrap did not create an administrator')
      const worker = await authorization.enrollIdentity('test', 'worker', {
        email: 'worker@example.com',
      })
      if (!worker) throw new Error('worker was not enrolled')
      const updater = graph.role('updater')
      const deleter = graph.role('deleter')
      const creator = graph.role('creator')
      if (!updater || !deleter || !creator) throw new Error('roles were not loaded')
      await asActor(admin.userId, () => authorization.assignRole(worker, updater.id))
      await asActor(admin.userId, () => authorization.assignRole(worker, deleter.id))

      expect(await asActor(admin.userId, () => server.db.create('Article', Array.from(
        { length: 100 },
        (_value, rank) => ({
          name: `Article ${rank}`,
          rank,
          score: 5,
          title: `Article ${rank}`,
        }),
      )))).toEqual({ created: 100 })
      expect(await asActor(worker, () => server.db.query('Article', { fields: ['id'], limit: null })))
        .toHaveLength(100)

      const ambiguous = await asActor(worker, () => server.db.upsert(
        'Article',
        'score == 5',
        { name: 'Ambiguous', rank: 200, score: 5, title: 'Ambiguous' },
      )).catch((error: unknown) => error)
      expect(ambiguous).toBeInstanceOf(MutationError)
      expect((ambiguous as MutationError).code).toBe('cardinality')
      expect(await asActor(worker, () => server.db.query('Article', { fields: ['id'], limit: null })))
        .toHaveLength(100)

      expect(await asActor(worker, () => server.db.edit(
        'Article',
        'score == 5',
        { score: 6 },
      ))).toEqual({ edited: 70 })
      const edited = await asActor(worker, () => server.db.query<{
        rank: number,
        score: number,
      }>('Article', { fields: ['rank', 'score'], limit: null, orderBy: 'rank' }))
      expect(edited.filter(row => row.score === 6)).toHaveLength(70)
      expect(edited.filter(row => row.score === 5)).toHaveLength(30)
      expect(edited.filter(row => row.rank < 70 && row.score === 6)).toHaveLength(70)

      expect(await asActor(worker, () => server.db.delete(
        'Article',
        'score == 6',
      ))).toEqual({ deleted: 40 })
      expect(await asActor(worker, () => server.db.query('Article', { fields: ['id'], limit: null })))
        .toHaveLength(60)

      const denied = await asActor(worker, () => server.db.create('Article', {
        name: 'Denied',
        rank: 5,
        score: 5,
        title: 'Denied',
      })).catch((error: unknown) => error)
      expect(denied).toBeInstanceOf(MutationError)
      expect((denied as MutationError).code).toBe('authorization')

      await asActor(admin.userId, () => authorization.assignRole(worker, creator.id))
      expect(await asActor(worker, () => server.db.create('Article', {
        name: 'Created',
        rank: 5,
        score: 5,
        title: 'Created',
      }))).toEqual({ created: 1 })

      expect(await asActor(worker, () => server.db.upsert(
        'Article',
        'rank == 200',
        { name: 'Upserted', rank: 200, score: 1, title: 'Upserted' },
      ))).toEqual({ created: 1, edited: 0 })
      expect(await asActor(worker, () => server.db.upsert(
        'Article',
        'rank == 50',
        { score: 2 },
      ))).toEqual({ created: 0, edited: 1 })
      expect(await asActor(worker, () => server.db.upsert(
        'Article',
        'rank == 80',
        { name: 'Read only', rank: 81, score: 2, title: 'Read only' },
      ))).toEqual({ created: 1, edited: 0 })
      const rows = await asActor(worker, () => server.db.query<{
        rank: number,
        score: number,
      }>('Article', { fields: ['rank', 'score'], limit: null, where: 'rank == 80' }))
      expect(rows).toEqual([{ rank: 80, score: 5 }])
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 180_000)
})
