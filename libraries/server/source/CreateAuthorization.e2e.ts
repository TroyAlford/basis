import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { fixtureRows, withDatabase } from '../testing/DatabaseFixture'
import { MutationError } from './Mutation'

const rows = fixtureRows

/**
 * Build one Resource create payload for a workspace.
 * @param workspace - Workspace reference identity.
 * @param name - Entity display name.
 * @returns The mutation values.
 */
function resource(workspace: string, name: string) {
  return { name, title: name, workspace }
}

describe('resource-scoped create authorization', () => {
  test('allows Owner and Editor, and denies Viewer or cross-workspace creates', async () => {
    await withDatabase('create-owner', rows.alice, async database => {
      expect(await database.create('Resource', resource(rows.visibleWorkspace, 'Owner resource')))
        .toMatchObject({ created: 1 })
    })
    await withDatabase('create-editor', rows.alice, async database => {
      expect(await database.create('Resource', resource(rows.editorWorkspace, 'Editor resource')))
        .toMatchObject({ created: 1 })
    })
    await withDatabase('create-viewer', rows.alice, async database => {
      const failure = await database.create('Resource', resource(rows.viewerWorkspace, 'Viewer resource'))
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('authorization')
    })
    await withDatabase('create-cross-workspace', rows.alice, async database => {
      const failure = await database.create('Resource', resource(rows.hiddenWorkspace, 'Hidden resource'))
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('authorization')
    })
  })

  test('keeps membership lookup privileged while membership READ is denied', async () => {
    await withDatabase('create-hidden-membership', rows.alice, async database => {
      expect(await database.sql<{ role: string }[]>`
        SELECT "role"
        FROM "WorkspaceMembership"
      `).toEqual([])
      expect(await database.create('Resource', resource(rows.visibleWorkspace, 'Hidden membership')))
        .toMatchObject({ created: 1 })
    })
  })

  test('denies a separate restricted actor from attaching a descendant-only row', async () => {
    await withDatabase('create-descendant-bob', rows.alice, async database => {
      const created = await database.create('CreateLeaf', {
        name: 'Valid parent chain',
        title: 'Valid parent chain',
        workspace: rows.visibleWorkspace,
      })
      const parent = created.record?.id
      expect(parent).toBeDefined()
      await database.sql`
        SELECT SET_CONFIG('actor.id', ${rows.bob}, TRUE)
      `
      await expect(database.sql`
        INSERT INTO "CreateSibling" ("id")
        VALUES
          (${parent})
      `).rejects.toThrow(/row-level security policy/)
    })
  })

  test('evaluates array-valued create predicates from proposed values', async () => {
    await withDatabase('create-array-valid', rows.alice, async database => {
      expect(await database.create('ArrayResource', {
        name: 'Valid array',
        scores: [2, 3],
      })).toMatchObject({ created: 1 })
    })
    await withDatabase('create-array-invalid', rows.alice, async database => {
      const failure = await database.create('ArrayResource', {
        name: 'Invalid array',
        scores: [1],
      }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('authorization')
    })
  })

  test('enforces create rules across an MTI insert chain', async () => {
    await withDatabase('create-mti-owner', rows.alice, async database => {
      expect(await database.create('CreateLeaf', {
        name: 'Owner MTI',
        title: 'Owner MTI',
        workspace: rows.visibleWorkspace,
      })).toMatchObject({ created: 1 })
    })
    await withDatabase('create-mti-invalid', rows.alice, async database => {
      const failure = await database.create('CreateLeaf', {
        name: 'Invalid MTI',
        title: 'Invalid MTI',
        workspace: rows.viewerWorkspace,
      }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('authorization')
    })
  })

  test('enforces the same rule for restricted direct SQL', async () => {
    const insert = async (database: DatabaseContext, id: string, workspace: string) => {
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${id}, ${`Direct ${id}`}, 'Resource')
      `
      await database.sql`
        INSERT INTO "Resource" ("id", "title", "workspace.id")
        VALUES
          (${id}, ${`Direct ${id}`}, ${workspace})
      `
    }

    const owner = randomUUID()
    await withDatabase('direct-owner', rows.alice, database => (
      insert(database, owner, rows.visibleWorkspace)
    ))

    const viewer = randomUUID()
    await expect(withDatabase('direct-viewer', rows.alice, database => (
      insert(database, viewer, rows.viewerWorkspace)
    ))).rejects.toThrow(/row-level security policy/)
  })
})
