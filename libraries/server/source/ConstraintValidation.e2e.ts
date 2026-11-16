import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { fixtureRows, withCommittedDatabase, withDatabase } from '../testing/DatabaseFixture'
import type { DatabaseTransaction } from './Database'
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
  test('validates transaction-final state and rolls back final invalidity', async () => {
    await withDatabase('validation-final', null, async database => {
      expect(identify(await database.create('Document', {
        flag: true,
        name: 'Valid',
        note: 'note',
        owner: rows.ownerA,
        revision: null,
        status: 'ok',
        title: 'Valid',
      }))).toBeDefined()
      expect((await database.upsert('Document', { title: 'Upsert' }, {
        flag: true,
        name: 'Upsert',
        note: 'note',
        owner: rows.ownerA,
        revision: null,
        status: 'ok',
        title: 'Upsert',
      })).created).toBe(1)

      await expect(database.create('Document', {
        flag: true,
        name: 'Invalid',
        note: 'note',
        owner: rows.ownerB,
        revision: rows.revisionA,
        status: 'ok',
        title: 'Invalid',
      })).rejects.toThrow('consistentRevisionOwner')

      await expect(database.tx(async sql => {
        await sql.create('Owner', { label: 'Rolled back', name: 'Rolled back' })
        await sql.create('Document', {
          flag: true,
          name: 'Final invalid',
          note: 'note',
          owner: rows.ownerB,
          revision: rows.revisionA,
          status: 'ok',
          title: 'Final invalid',
        })
      })).rejects.toThrow('consistentRevisionOwner')
    })
  })

  test('allows intermediate repair and skips subjects deleted before commit', async () => {
    await withDatabase('validation-repair', null, async database => {
      await database.tx(async sql => {
        const document = await sql.create('Document', {
          flag: true,
          name: 'Repaired',
          note: 'note',
          owner: rows.ownerB,
          revision: rows.revisionA,
          status: 'ok',
          title: 'Repaired',
        })
        await sql.edit('Document', { id: identify(document) }, { owner: rows.ownerA })
      })
      await database.tx(async sql => {
        const document = await sql.create('Document', {
          flag: true,
          name: 'Deleted',
          note: 'note',
          owner: rows.ownerB,
          revision: rows.revisionA,
          status: 'ok',
          title: 'Deleted',
        })
        await sql.delete('Document', { id: identify(document) })
      })
    })
  })

  test('rejects UNKNOWN optional paths and validates multi-hop relational paths', async () => {
    await withDatabase('validation-relational', null, async database => {
      await expect(database.create('Document', {
        flag: true,
        name: 'Orphan',
        note: 'note',
        owner: rows.ownerA,
        revision: rows.orphanRevision,
        status: 'ok',
        title: 'Orphan',
      })).rejects.toThrow('consistentRevisionOwner')

      const section = identify(await database.create('Section', {
        document: rows.validDocument,
        name: 'Section',
        title: 'Section',
      }))
      const asset = identify(await database.create('Asset', {
        name: 'Asset',
        owner: rows.ownerA,
        section,
      }))
      await expect(database.create('Asset', {
        name: 'Bad asset',
        owner: rows.ownerB,
        section,
      })).rejects.toThrow('consistentSectionOwner')
      await expect(database.create('Piece', {
        asset,
        name: 'Bad piece',
        owner: rows.ownerB,
      })).rejects.toThrow('consistentAssetOwner')
      expect(identify(await database.create('Piece', {
        asset,
        name: 'Good piece',
        owner: rows.ownerA,
      }))).toBeDefined()
    })
  })

  test('accepts valid self-revocation and rejects invalid self-revocation', async () => {
    const guard = rows.guardedWorkspace
    await withDatabase('validation-self-valid', rows.alice, async database => {
      await database.tx(async sql => {
        await sql.edit('GuardedWorkspace', { id: guard }, { title: 'Valid edit' })
        await database.sql`
          DELETE FROM "GuardedMembership"
          WHERE "workspace.id" = ${guard}
        `
      })
    })
    await withDatabase('validation-self-invalid', rows.alice, async database => {
      await expect(database.tx(async sql => {
        await sql.edit('GuardedWorkspace', { id: guard }, { flag: false })
        await database.sql`
          DELETE FROM "GuardedMembership"
          WHERE "workspace.id" = ${guard}
        `
      })).rejects.toThrow('guardedFlag')
    })
  })

  test('keeps validation armed when an attempted delete removes no rows', async () => {
    await withDatabase('validation-denied-delete', rows.alice, async database => {
      let deleted = -1
      const failure = await database.tx(async sql => {
        await sql.edit('GuardedWorkspace', { id: rows.guardedWorkspace }, { flag: false })
        deleted = (await sql.delete('GuardedWorkspace', { id: rows.guardedWorkspace })).deleted
      }).catch((error: unknown) => error)
      expect(deleted).toBe(0)
      expect(failure).toBeInstanceOf(MutationError)
      expect((failure as MutationError).code).toBe('constraint')
      expect((failure as Error).message).toContain('guardedFlag')
    })
  })

  test('validates inherited and child MTI fields through canonical root provenance', async () => {
    await withDatabase('validation-mti', null, async database => {
      expect(await database.edit('Document', { id: rows.validDocument }, { title: 'Inherited edit' }))
        .toMatchObject({ edited: 1 })
      expect(await database.edit('Document', { id: rows.validDocument }, { note: 'Child edit' }))
        .toMatchObject({ edited: 1 })
      await expect(database.edit('Document', { id: rows.invalidChildDocument }, { title: 'Invalid child' }))
        .rejects.toThrow('documentFlag')
      await expect(database.edit('Document', { id: rows.invalidParentDocument }, { note: 'Invalid parent' }))
        .rejects.toThrow('recordStatus')
    })
  })

  test('restores Graph write tracking when a savepoint rolls back', async () => {
    await expect(withCommittedDatabase('validation-savepoint-invalid', null, async database => {
      const savepoint = database.sql.savepoint as unknown as <T>(
        work: (sql: DatabaseTransaction) => T | Promise<T>,
      ) => Promise<T>
      await database.edit('Document', { id: rows.validDocument }, { flag: false })
      await savepoint(async sql => {
        await sql.delete('Document', { id: rows.validDocument })
        throw new Error('roll back only the delete')
      }).catch(() => undefined)
    })).rejects.toThrow('documentFlag')

    let invalid = ''
    const valid = await withCommittedDatabase('validation-savepoint-valid', null, async database => {
      const savepoint = database.sql.savepoint as unknown as <T>(
        work: (sql: DatabaseTransaction) => T | Promise<T>,
      ) => Promise<T>
      const document = identify(await database.create('Document', {
        flag: true,
        name: `Savepoint valid ${randomUUID()}`,
        note: 'note',
        owner: rows.ownerA,
        revision: null,
        status: 'ok',
        title: 'Savepoint valid',
      }))
      await savepoint(async sql => {
        invalid = identify(await sql.create('Document', {
          flag: true,
          name: `Savepoint invalid ${randomUUID()}`,
          note: 'note',
          owner: rows.ownerB,
          revision: rows.revisionA,
          status: 'ok',
          title: 'Savepoint invalid',
        }))
        throw new Error('roll back the invalid create')
      }).catch(() => undefined)
      return document
    })
    expect(await withDatabase('validation-savepoint-read', null, database => (
      database.query('Document', {
        fields: ['id'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: valid },
      })
    ))).toHaveLength(1)
    expect(await withDatabase('validation-savepoint-invalid-read', null, database => (
      database.query('Document', {
        fields: ['id'],
        where: { field: 'id', operator: Operator.Comparison.Equal, value: invalid },
      })
    ))).toEqual([])
  })

  test('exposes rollback, savepoint, and test transaction extensions', async () => {
    await withDatabase('validation-transaction-controls', null, async database => {
      const savepoint = database.sql.savepoint as unknown as <T>(
        work: (sql: DatabaseTransaction) => T | Promise<T>,
      ) => Promise<T>
      expect(await savepoint(async sql => {
        await sql.create('Owner', { label: 'Savepoint', name: 'Savepoint' })
        return 'savepoint'
      })).toBe('savepoint')
      await expect(savepoint(async () => {
        throw new Error('savepoint rollback')
      })).rejects.toThrow('savepoint rollback')
      expect(await database.sql.test(async sql => {
        await sql.create('Owner', { label: 'Test', name: 'Test' })
        return 'test'
      })).toBe('test')
    })
  })
})
