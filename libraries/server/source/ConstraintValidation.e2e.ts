import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { fixtureRows, seedGuardedWorkspace, withCommittedDatabase, withDatabase } from '../testing/DatabaseFixture'
import { MutationError } from './Mutation'
import { Operator } from './Operator'

const rows = fixtureRows

/**
 * Require a hydrated identity from one mutation result.
 * @param result - Mutation result.
 * @param result.record - Hydrated record, when returned.
 * @param result.record.id - Hydrated record identity.
 * @returns The hydrated identity.
 */
function identify(result: { readonly record?: { readonly id: string } }): string {
  if (!result.record) throw new Error('mutation did not return a record')
  return result.record.id
}

describe('Graph validation constraints', () => {
  test('commits valid final state and rolls back final invalidity', async () => {
    const valid = await withCommittedDatabase('validation-final', null, async database => {
      const document = identify(await database.create('Document', {
        flag: true,
        name: `Valid ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerA,
        revision: null,
        status: 'ok',
        title: 'Valid',
      }))
      const upsertTitle = `Upsert ${randomUUID()}`
      const upsert = await database.upsert('Document', { title: upsertTitle }, {
        flag: true,
        name: `Upsert ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerA,
        revision: null,
        status: 'ok',
        title: upsertTitle,
      })
      return { document, upserted: upsert.created }
    })
    expect(valid.upserted).toBe(1)
    expect(await withDatabase('validation-final-read', null, database => (
      database.query('Document', {
        fields: ['id'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: valid.document },
      })
    ))).toHaveLength(1)

    let priorOwner = ''
    await expect(withCommittedDatabase('validation-invalid', null, async database => {
      priorOwner = identify(await database.create('Owner', {
        label: 'Rolled back',
        name: 'Rolled back',
      }))
      await database.create('Document', {
        flag: true,
        name: 'Invalid',
        note: 'note',
        owner: rows.ownerB,
        revision: rows.revisionA,
        status: 'ok',
        title: 'Invalid',
      })
    })).rejects.toThrow('consistentRevisionOwner')
    expect(await withDatabase('validation-invalid-owner', null, database => (
      database.query('Owner', {
        fields: ['id'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: priorOwner },
      })
    ))).toEqual([])
  })

  test('allows intermediate repair and commits deleted subjects', async () => {
    const repaired = await withCommittedDatabase('validation-repair', null, async database => {
      const document = identify(await database.create('Document', {
        flag: true,
        name: `Repaired ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerB,
        revision: rows.revisionA,
        status: 'ok',
        title: 'Repaired',
      }))
      await database.edit('Document', { id: document }, { owner: rows.ownerA })
      return document
    })
    expect(await withDatabase('validation-repair-read', null, database => (
      database.query('Document', {
        fields: ['id'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: repaired },
      })
    ))).toHaveLength(1)

    const deleted = await withCommittedDatabase('validation-deleted', null, async database => {
      const document = identify(await database.create('Document', {
        flag: true,
        name: `Deleted ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerB,
        revision: rows.revisionA,
        status: 'ok',
        title: 'Deleted',
      }))
      await database.delete('Document', { id: document })
      return document
    })
    expect(await withDatabase('validation-deleted-read', null, database => (
      database.query('Document', {
        fields: ['id'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: deleted },
      })
    ))).toEqual([])
  })

  test('rejects UNKNOWN optional paths and validates multi-hop relational paths', async () => {
    await expect(withCommittedDatabase('validation-orphan', null, database => (
      database.create('Document', {
        flag: true,
        name: `Orphan ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerA,
        revision: rows.orphanRevision,
        status: 'ok',
        title: 'Orphan',
      })
    ))).rejects.toThrow('consistentRevisionOwner')

    await withCommittedDatabase('validation-relational', null, async database => {
      const section = identify(await database.create('Section', {
        document: rows.validDocument,
        name: `Section ${randomUUID()}`,
        title: 'Section',
      }))
      const asset = identify(await database.create('Asset', {
        name: `Asset ${randomUUID()}`,
        owner: rows.ownerA,
        section,
      }))
      expect(identify(await database.create('Piece', {
        asset,
        name: `Good piece ${randomUUID()}`,
        owner: rows.ownerA,
      }))).toBeDefined()
      return { asset, section }
    }).then(async ({ asset, section }) => {
      await expect(withCommittedDatabase('validation-bad-asset', null, database => (
        database.create('Asset', {
          name: `Bad asset ${randomUUID()}`,
          owner: rows.ownerB,
          section,
        })
      ))).rejects.toThrow('consistentSectionOwner')
      await expect(withCommittedDatabase('validation-bad-piece', null, database => (
        database.create('Piece', {
          asset,
          name: `Bad piece ${randomUUID()}`,
          owner: rows.ownerB,
        })
      ))).rejects.toThrow('consistentAssetOwner')
    })
  })

  test('commits valid self-revocation and rolls back invalid self-revocation', async () => {
    const valid = await withCommittedDatabase('validation-self-valid', rows.alice, async database => {
      const workspace = await seedGuardedWorkspace(rows.alice)
      await database.edit('GuardedWorkspace', { id: workspace }, { title: 'Valid edit' })
      await database.sql`
        DELETE FROM "GuardedMembership"
        WHERE "workspace.id" = ${workspace}
      `
      return workspace
    })
    expect(await withDatabase('validation-self-valid-read', rows.alice, database => (
      database.sql<{ flag: boolean }[]>`
        SELECT "flag"
        FROM "GuardedWorkspace"
        WHERE "id" = ${valid}
      `
    ))).toEqual([])

    let invalidWorkspace = ''
    const invalid = await withCommittedDatabase('validation-self-invalid', rows.alice, async database => {
      invalidWorkspace = await seedGuardedWorkspace(rows.alice)
      await database.edit('GuardedWorkspace', { id: invalidWorkspace }, { flag: false })
      await database.sql`
        DELETE FROM "GuardedMembership"
        WHERE "workspace.id" = ${invalidWorkspace}
      `
    }).catch((error: unknown) => error)
    expect(invalid).toBeInstanceOf(MutationError)
    expect((invalid as MutationError).code).toBe('constraint')
    expect((invalid as Error).message).toContain('guardedFlag')
    expect(await withDatabase('validation-self-invalid-read', rows.alice, database => (
      database.query('GuardedWorkspace', {
        fields: ['flag'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: invalidWorkspace },
      })
    ))).toEqual([{ flag: true }])
  })

  test('keeps validation armed when an attempted delete removes no rows', async () => {
    let workspace = ''
    await withCommittedDatabase('validation-denied-delete', rows.alice, async database => {
      workspace = await seedGuardedWorkspace(rows.alice)
      await database.edit('GuardedWorkspace', { id: workspace }, { flag: false })
      expect((await database.delete('GuardedWorkspace', { id: workspace })).deleted).toBe(0)
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(MutationError)
      expect((error as MutationError).code).toBe('constraint')
      expect((error as Error).message).toContain('guardedFlag')
      return error
    })
    expect(await withDatabase('validation-denied-delete-read', rows.alice, database => (
      database.query('GuardedWorkspace', {
        fields: ['flag'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: workspace },
      })
    ))).toEqual([{ flag: true }])
  })

  test('validates inherited and child MTI fields through canonical root provenance', async () => {
    const valid = await withCommittedDatabase('validation-mti', null, async database => {
      const document = identify(await database.create('Document', {
        flag: true,
        name: `MTI ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerA,
        revision: null,
        status: 'ok',
        title: 'MTI',
      }))
      await database.edit('Document', { id: document }, { title: 'Inherited edit' })
      await database.edit('Document', { id: document }, { note: 'Child edit' })
      return document
    })
    expect(valid).toBeDefined()
    await expect(withCommittedDatabase('validation-mti-child', null, database => (
      database.edit('Document', { id: rows.invalidChildDocument }, { title: 'Invalid child' })
    ))).rejects.toThrow('documentFlag')
    await expect(withCommittedDatabase('validation-mti-parent', null, database => (
      database.edit('Document', { id: rows.invalidParentDocument }, { note: 'Invalid parent' })
    ))).rejects.toThrow('recordStatus')
  })
})
