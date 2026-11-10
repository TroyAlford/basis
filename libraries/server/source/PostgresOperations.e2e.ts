import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import type { SQL as BunSQL } from 'bun'
import { describe, expect, test } from 'bun:test'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { removeService } from '../testing/DatabaseFixture'
import { ManagedPostgresOperations } from './PostgresOperations'
import { Server } from './Server'

const silent = new Logger({ silent: true })

describe('Managed PostgreSQL operations', () => {
  test('backs up, verifies an isolated restore, and upgrades a major version', async () => {
    const install = tempDirectory('basis-postgres-operations-')
    const previous = process.cwd()
    process.chdir(install)
    const source = new Server()
      .root(install)
      .database({ image: 'postgres:16.4-alpine' })
      .start({ development: false, hostname: '127.0.0.1', logger: silent, port: 0 })
    process.chdir(previous)
    try {
      await source.ready()
      await source.db.sql`
        CREATE TABLE ops_probe (id text PRIMARY KEY, value text NOT NULL)
      `
      await source.db.sql`
        INSERT INTO ops_probe (id, value)
        VALUES ('one', 'preserved')
      `

      expect(await source.db.sql<{
        rolbypassrls: boolean,
        rolcreatedb: boolean,
        rolcreaterole: boolean,
        rolinherit: boolean,
        rolsuper: boolean,
      }[]>`
        SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
        FROM pg_roles
        WHERE rolname = 'basis_backup'
      `).toEqual([{
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: true,
        rolsuper: false,
      }])

      const operations = new ManagedPostgresOperations({ installation: install })
      const backup = await operations.backup()
      expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/)
      expect(backup.image).toBe('postgres:16.4-alpine')
      expect((await stat(backup.path)).mode & 0o777).toBe(0o600)
      expect((await stat(backup.manifest)).mode & 0o777).toBe(0o600)
      for (const name of ['password', 'backup-password']) {
        expect((await stat(join(install, '.basis', 'database', name))).mode & 0o777).toBe(0o600)
      }

      const verify = async (sql: BunSQL): Promise<void> => {
        const rows = await sql<{ id: string, value: string }[]>`
          SELECT id, value
          FROM ops_probe
        `
        expect(rows).toEqual([{ id: 'one', value: 'preserved' }])
      }
      await expect(operations.restore(backup.path, {
        image: 'postgres:17-alpine',
        verify,
      })).resolves.toEqual({ image: 'postgres:17-alpine', verified: true })

      await source.shutdown()
      const upgradedResult = await operations.upgrade('postgres:17-alpine', { verify })
      expect(upgradedResult).toMatchObject({
        image: 'postgres:17-alpine',
        previousImage: 'postgres:16.4-alpine',
      })

      process.chdir(install)
      const upgraded = new Server()
        .root(install)
        .database({ image: 'postgres:17-alpine' })
        .start({ development: false, hostname: '127.0.0.1', logger: silent, port: 0 })
      process.chdir(previous)
      try {
        await upgraded.ready()
        expect(await upgraded.db.sql<{ id: string, value: string }[]>`
          SELECT id, value
          FROM ops_probe
        `).toEqual([{ id: 'one', value: 'preserved' }])
      } finally {
        await upgraded.shutdown()
      }

      await operations.rollback(backup.path, 'postgres:16.4-alpine', verify)
      process.chdir(install)
      const rolledBack = new Server()
        .root(install)
        .database({ image: 'postgres:16.4-alpine' })
        .start({ development: false, hostname: '127.0.0.1', logger: silent, port: 0 })
      process.chdir(previous)
      try {
        await rolledBack.ready()
        expect(await rolledBack.db.sql<{ id: string, value: string }[]>`
          SELECT id, value
          FROM ops_probe
        `).toEqual([{ id: 'one', value: 'preserved' }])
      } finally {
        await rolledBack.shutdown()
      }
    } finally {
      await source.shutdown()
      removeService(install)
    }
  }, 180_000)
})
