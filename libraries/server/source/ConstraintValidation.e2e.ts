import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { runAsActor } from './ActorContext'
import { openAdmin } from './Database'
import { Constraint } from './EntityDefinitions'
import { Action } from './Graph'
import { Graph } from './Graph'
import type { AuthoredSecurity } from './GraphAuthoring'
import { MutationError } from './Mutation'
import type { Server } from './Server'
import { Server as BasisServer } from './Server'

const silent = new Logger({ silent: true })

const administrator: AuthoredSecurity = {
  [Action.Create]: { role: 'admin' },
  [Action.Delete]: { role: 'admin' },
  [Action.Read]: { role: 'admin' },
  [Action.Update]: { role: 'admin' },
}

const graph = new Graph({
  entities: [
    { fields: [{ field: 'label', type: 'String' }], name: 'Owner', security: administrator },
    {
      constraints: [{
        description: 'An optional revision belongs to the document owner.',
        name: 'consistentRevisionOwner',
        type: Constraint.Validation,
        where: 'revision = null OR owner = revision.owner',
      }],
      fields: [
        { field: 'owner', target: 'Owner', type: 'Entity' },
        { field: 'revision', nullable: true, target: 'Revision', type: 'Entity' },
        { field: 'title', type: 'String' },
      ],
      name: 'Document',
      security: administrator,
    },
    {
      fields: [{ field: 'owner', nullable: true, target: 'Owner', type: 'Entity' }],
      name: 'Revision',
      security: administrator,
    },
    {
      fields: [
        { field: 'document', nullable: true, target: 'Document', type: 'Entity' },
        { field: 'title', type: 'String' },
      ],
      name: 'Section',
      security: administrator,
    },
    {
      constraints: [{
        description: 'A section document belongs to the same owner as the asset.',
        name: 'consistentSectionOwner',
        type: Constraint.Validation,
        where: 'section = null OR section.document.owner = owner',
      }],
      fields: [
        { field: 'owner', target: 'Owner', type: 'Entity' },
        { field: 'section', nullable: true, target: 'Section', type: 'Entity' },
      ],
      name: 'Asset',
      security: administrator,
    },
    {
      constraints: [{
        description: 'An optional asset belongs to the piece owner.',
        name: 'consistentAssetOwner',
        type: Constraint.Validation,
        where: 'asset = null OR asset.owner = owner',
      }],
      fields: [
        { field: 'asset', nullable: true, target: 'Asset', type: 'Entity' },
        { field: 'owner', target: 'Owner', type: 'Entity' },
      ],
      name: 'Piece',
      security: administrator,
    },
  ],
})

/**
 * Start one isolated server for a validation graph.
 * @param install - Temporary installation root.
 * @param applicationGraph - Graph to install; defaults to the module fixture.
 * @returns The started server and its bootstrapped administrator.
 */
async function start(
  install: string,
  applicationGraph: Graph = graph,
): Promise<{ readonly admin: string, readonly server: Server }> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new BasisServer()
    .graph(applicationGraph)
    .database()
    .root(install)
  server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  try {
    await server.ready()
  } finally {
    process.chdir(previous)
  }
  const connection = await openAdmin(server.db)
  try {
    await installSchema(connection.sql, applicationGraph, {
      appRole: 'basis_app',
      schema: 'public',
      superuser: true,
      version: `constraint-validation-${randomUUID()}`,
    })
  } finally {
    await connection.close()
  }
  const authorization = server.auth
  if (!authorization) throw new Error('authorization did not initialize')
  const bootstrapped = await authorization.bootstrap({
    displayName: 'Admin',
    email: 'admin@example.com',
    provider: 'test',
    subject: 'admin',
  })
  if (!bootstrapped.userId) throw new Error('bootstrap did not create an administrator')
  return { admin: bootstrapped.userId, server }
}

/**
 * Require the hydrated record from a single-row mutation.
 * @param result - Mutation result.
 * @param result.record - Hydrated record, when returned.
 * @param result.record.id - Hydrated record identity.
 * @returns The hydrated record identity.
 */
function identify(result: { readonly record?: { readonly id: string } }): string {
  if (!result.record) throw new Error('mutation did not return a record')
  return result.record.id
}

describe('Graph validation constraints', () => {
  test('validates transaction-final state before commit and rolls back every write', async () => {
    const install = tempDirectory('basis-constraint-validation-')
    const { admin, server } = await start(install)
    try {
      const asAdmin = <T>(work: () => T): T => runAsActor({ id: admin }, work)
      const ownerA = identify(await asAdmin(() => server.db.create('Owner', { label: 'A', name: 'Owner A' })))
      const ownerB = identify(await asAdmin(() => server.db.create('Owner', { label: 'B', name: 'Owner B' })))
      const revision = identify(await asAdmin(() => server.db.create('Revision', {
        name: 'Revision',
        owner: ownerA,
      })))

      const valid = identify(await asAdmin(() => server.db.create('Document', {
        name: 'Valid',
        owner: ownerA,
        revision,
        title: 'Valid',
      })))
      expect(valid).toBeDefined()
      const upserted = await asAdmin(() => server.db.upsert('Document', { title: 'Upsert valid' }, {
        name: 'Upsert valid',
        owner: ownerA,
        revision: null,
        title: 'Upsert valid',
      }))
      expect(upserted.created).toBe(1)

      const failure = await asAdmin(() => server.db.create('Document', {
        name: 'Invalid',
        owner: ownerB,
        revision,
        title: 'Invalid',
      })).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('constraint')
      expect((failure as Error).message).toContain('consistentRevisionOwner')
      expect((failure as Error).message).not.toContain('Invalid')
      const documents = await asAdmin(() => server.db.query('Document', {
        fields: ['id'],
        limit: null,
      }))
      expect(documents).toHaveLength(2)

      await expect(asAdmin(() => server.db.tx(async sql => {
        await sql.create('Owner', { label: 'Rolled back', name: 'Rolled back' })
        await sql.create('Document', { name: 'Final invalid', owner: ownerB, revision, title: 'Final invalid' })
      }))).rejects.toThrow('consistentRevisionOwner')
      const rolledBack = await asAdmin(() => server.db.query('Owner', {
        fields: ['id'],
        limit: null,
        where: { label: 'Rolled back' },
      }))
      expect(rolledBack).toEqual([])
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)

  test('revalidates only transaction-final state and skips deleted subjects', async () => {
    const install = tempDirectory('basis-constraint-final-state-')
    const { admin, server } = await start(install)
    try {
      const asAdmin = <T>(work: () => T): T => runAsActor({ id: admin }, work)
      const ownerA = identify(await asAdmin(() => server.db.create('Owner', { label: 'A', name: 'Owner A' })))
      const ownerB = identify(await asAdmin(() => server.db.create('Owner', { label: 'B', name: 'Owner B' })))
      const revision = identify(await asAdmin(() => server.db.create('Revision', {
        name: 'Revision',
        owner: ownerA,
      })))

      await asAdmin(() => server.db.tx(async sql => {
        const document = await sql.create('Document', {
          name: 'Repaired',
          owner: ownerB,
          revision,
          title: 'Repaired',
        })
        expect(document.record).toBeDefined()
        await sql.edit('Document', { id: identify(document) }, { owner: ownerA })
      }))
      const repaired = await asAdmin(() => server.db.query('Document', {
        fields: ['id', 'owner'],
        limit: null,
        where: { title: 'Repaired' },
      }))
      expect(repaired).toHaveLength(1)

      await asAdmin(() => server.db.tx(async sql => {
        const document = await sql.create('Document', {
          name: 'Deleted before commit',
          owner: ownerB,
          revision,
          title: 'Deleted before commit',
        })
        await sql.delete('Document', { id: identify(document) })
      }))

      await expect(asAdmin(() => server.db.upsert('Document', { title: 'Upserted' }, {
        name: 'Upserted',
        owner: ownerB,
        revision,
        title: 'Upserted',
      }))).rejects.toThrow('consistentRevisionOwner')
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)

  test('rejects UNKNOWN optional paths and validates relational multi-hop paths', async () => {
    const install = tempDirectory('basis-constraint-paths-')
    const { admin, server } = await start(install)
    try {
      const asAdmin = <T>(work: () => T): T => runAsActor({ id: admin }, work)
      const ownerA = identify(await asAdmin(() => server.db.create('Owner', { label: 'A', name: 'Owner A' })))
      const ownerB = identify(await asAdmin(() => server.db.create('Owner', { label: 'B', name: 'Owner B' })))
      const orphanRevision = identify(await asAdmin(() => server.db.create('Revision', {
        name: 'Orphan revision',
        owner: null,
      })))
      await expect(asAdmin(() => server.db.create('Document', {
        name: 'Unknown',
        owner: ownerA,
        revision: orphanRevision,
        title: 'Unknown',
      }))).rejects.toThrow('consistentRevisionOwner')

      const document = identify(await asAdmin(() => server.db.create('Document', {
        name: 'Section document',
        owner: ownerA,
        title: 'Section document',
      })))
      const section = identify(await asAdmin(() => server.db.create('Section', {
        document,
        name: 'Section',
        title: 'Section',
      })))
      const asset = identify(await asAdmin(() => server.db.create('Asset', {
        name: 'Asset',
        owner: ownerA,
        section,
      })))
      await expect(asAdmin(() => server.db.create('Asset', {
        name: 'Asset B',
        owner: ownerB,
        section,
      }))).rejects.toThrow('consistentSectionOwner')
      await expect(asAdmin(() => server.db.create('Piece', {
        asset,
        name: 'Piece B',
        owner: ownerB,
      }))).rejects.toThrow('consistentAssetOwner')
      expect(identify(await asAdmin(() => server.db.create('Piece', {
        asset,
        name: 'Piece A',
        owner: ownerA,
      })))).toBeDefined()
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)

  test('validates a written subject that becomes invisible to the writer', async () => {
    const invisibleGraph = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        {
          constraints: [{
            description: 'A workspace must remain flagged.',
            name: 'requiresFlag',
            type: Constraint.Validation,
            where: 'flag = true',
          }],
          fields: [
            { field: 'title', type: 'String' },
            { field: 'flag', type: 'Boolean' },
          ],
          name: 'Workspace',
          security: {
            [Action.Create]: { role: 'admin' },
            [Action.Read]: { where: '$me != null $and members $contains (id = $me)' },
            [Action.Update]: { role: 'admin' },
          },
        },
      ],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMember',
        security: {
          [Action.Create]: { role: 'admin' },
          [Action.Delete]: { role: 'admin' },
          [Action.Read]: { role: 'admin' },
        },
      }],
      security: {
        ExternalIdentity: { [Action.Manage]: { role: 'admin' } },
        Role: { [Action.Manage]: { role: 'admin' } },
        UserRole: { [Action.Manage]: { role: 'admin' } },
      },
    })
    const install = tempDirectory('basis-constraint-invisible-')
    const { admin, server } = await start(install, invisibleGraph)
    const connection = await openAdmin(server.db)
    try {
      const workspace = randomUUID()
      const validWorkspace = randomUUID()
      await connection.sql.begin(async tx => {
        for (const [id, title] of [[workspace, 'Workspace'], [validWorkspace, 'Valid workspace']] as const) {
          await tx`INSERT INTO "Entity" ("id", "name", "entity") VALUES (${id}, ${title}, 'Workspace')`
          await tx`INSERT INTO "Workspace" ("id", "title", "flag") VALUES (${id}, ${title}, TRUE)`
          await tx`
            INSERT INTO "WorkspaceMember" ("workspace.id", "user.id", "role")
            VALUES (${id}, ${admin}, 'Owner')
          `
        }
      })
      const asAdmin = <T>(work: () => T): T => runAsActor({ id: admin }, work)
      const failure = await asAdmin(() => server.db.tx(async sql => {
        await sql.edit('Workspace', { id: workspace }, { flag: false })
        await sql`
          DELETE FROM "WorkspaceMember"
          WHERE "workspace.id" = ${workspace}
        `
      })).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('constraint')
      expect((failure as Error).message).toContain('requiresFlag')
      const [state] = await asAdmin(() => server.db.query('Workspace', {
        fields: ['id', 'flag'],
        where: { id: workspace },
      })) as { flag: boolean, id: string }[]
      expect(state).toEqual({ flag: true, id: workspace })
      const [membership] = await connection.sql.unsafe<{ id: string }[]>(
        'SELECT "user.id" AS "id" FROM "WorkspaceMember" WHERE "workspace.id" = $1',
        [workspace],
      )
      expect(membership?.id).toBe(admin)

      await asAdmin(() => server.db.tx(async sql => {
        await sql.edit('Workspace', { id: validWorkspace }, { title: 'Valid edit' })
        await sql`
          DELETE FROM "WorkspaceMember"
          WHERE "workspace.id" = ${validWorkspace}
        `
      }))
      const [validState] = await connection.sql.unsafe<{ flag: boolean, title: string }[]>(
        'SELECT "flag", "title" FROM "Workspace" WHERE "id" = $1',
        [validWorkspace],
      )
      expect(validState).toEqual({ flag: true, title: 'Valid edit' })
      const validMembership = await connection.sql.unsafe<{ id: string }[]>(
        'SELECT "user.id" AS "id" FROM "WorkspaceMember" WHERE "workspace.id" = $1',
        [validWorkspace],
      )
      expect(validMembership).toEqual([])
      const validator = invisibleGraph.definitions.validationConstraints('Workspace')[0]?.validator
      if (!validator) throw new Error('validation helper was not compiled')
      const foreign = await runAsActor({ id: null }, () => server.db.tx(async sql => (
        sql.unsafe<{ valid: boolean }[]>(`SELECT ${validator}($1) AS "valid"`, [validWorkspace])
      )))
      expect(foreign).toEqual([{ valid: false }])
      const written = await asAdmin(() => server.db.tx(async sql => {
        await sql.edit('Workspace', { id: workspace }, { title: 'Written edit' })
        return sql.unsafe<{ valid: boolean }[]>(`SELECT ${validator}($1) AS "valid"`, [workspace])
      }))
      expect(written).toEqual([{ valid: true }])
    } finally {
      await connection.close()
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)

  test('keeps validation armed when an attempted delete removes no rows', async () => {
    const deleteGraph = new Graph({
      entities: [{
        constraints: [{
          description: 'A guarded item must remain flagged.',
          name: 'requiresFlag',
          type: Constraint.Validation,
          where: 'flag = true',
        }],
        fields: [
          { field: 'title', type: 'String' },
          { field: 'flag', type: 'Boolean' },
        ],
        name: 'GuardedItem',
        security: {
          [Action.Create]: { role: 'admin' },
          [Action.Delete]: { role: 'deleter' },
          [Action.Read]: { role: 'writer' },
          [Action.Update]: { role: 'writer' },
        },
      }],
      roles: {
        deleter: { name: 'Deleter' },
        writer: { name: 'Writer' },
      },
      security: {
        ExternalIdentity: { [Action.Manage]: { role: 'admin' } },
        Role: { [Action.Manage]: { role: 'admin' } },
        UserRole: { [Action.Manage]: { role: 'admin' } },
      },
    })
    const install = tempDirectory('basis-constraint-denied-delete-')
    const { admin, server } = await start(install, deleteGraph)
    const connection = await openAdmin(server.db)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const writerRole = deleteGraph.role('writer')
      const deleterRole = deleteGraph.role('deleter')
      if (!writerRole || !deleterRole) throw new Error('roles were not loaded')
      const writer = await authorization.enrollIdentity('test', 'writer', { email: 'writer@example.com' })
      const closer = await authorization.enrollIdentity('test', 'closer', { email: 'closer@example.com' })
      if (!writer || !closer) throw new Error('actors were not enrolled')
      const asAdmin = <T>(work: () => T): T => runAsActor({ id: admin }, work)
      await asAdmin(() => authorization.assignRole(writer, writerRole.id))
      await asAdmin(() => authorization.assignRole(closer, writerRole.id))
      await asAdmin(() => authorization.assignRole(closer, deleterRole.id))
      const guarded = randomUUID()
      const closable = randomUUID()
      await connection.sql.begin(async tx => {
        for (const [id, title] of [[guarded, 'Guarded'], [closable, 'Closable']] as const) {
          await tx`INSERT INTO "Entity" ("id", "name", "entity") VALUES (${id}, ${title}, 'GuardedItem')`
          await tx`INSERT INTO "GuardedItem" ("id", "title", "flag") VALUES (${id}, ${title}, TRUE)`
        }
      })
      const asWriter = <T>(work: () => T): T => runAsActor({ id: writer }, work)
      const denied = await asWriter(() => server.db.tx(async sql => {
        await sql.edit('GuardedItem', { id: guarded }, { flag: false })
        return sql.delete('GuardedItem', { id: guarded })
      })).catch((error: unknown) => error)
      expect(denied).toBeInstanceOf(MutationError)
      expect((denied as MutationError).code).toBe('constraint')
      expect((denied as Error).message).toContain('requiresFlag')
      const surviving = await asWriter(() => server.db.query('GuardedItem', {
        fields: ['flag'],
        where: { id: guarded },
      })) as { flag: boolean }[]
      expect(surviving).toEqual([{ flag: true }])

      const asCloser = <T>(work: () => T): T => runAsActor({ id: closer }, work)
      expect(await asCloser(() => server.db.tx(async sql => {
        await sql.edit('GuardedItem', { id: closable }, { flag: false })
        return sql.delete('GuardedItem', { id: closable })
      }))).toEqual({ deleted: 1 })
      const removed = await connection.sql.unsafe<{ id: string }[]>(
        'SELECT "id" FROM "Entity" WHERE "id" = $1',
        [closable],
      )
      expect(removed).toEqual([])
    } finally {
      await connection.close()
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)
})
