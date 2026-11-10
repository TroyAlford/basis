import { tempDirectory } from 'basis/testing'
import { SQL as BunSQL } from 'bun'
import { describe, expect, test } from 'bun:test'
import { rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { createDatabase, openAdmin } from './Database'
import { Graph } from './Graph'
import { ManagedPostgresService } from './ManagedPostgresService'
import type { MigrationArtifact } from './Schema'
import { DDL } from './Schema'

describe('interrupted database cutover recovery', () => {
  test('recovers the original database after process death beyond source detachment', async () => {
    const install = tempDirectory('basis-cutover-recovery-')
    let child: ReturnType<typeof Bun.spawn> | null = null
    try {
      const previous = process.cwd()
      const graph = new Graph({
        entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      })
      process.chdir(install)
      const database = createDatabase({
        authorization: true,
        entities: graph.definitions,
        image: 'postgres:16.4-alpine',
      })
      let artifact: MigrationArtifact
      try {
        await database.connect()
        const admin = await openAdmin(database)
        try {
          artifact = await installSchema(admin.sql, graph, {
            appRole: 'basis_app',
            schema: 'public',
            superuser: true,
            version: 'recovery-initial',
          })
        } finally {
          await admin.close()
        }
      } finally {
        process.chdir(previous)
        await database.close()
      }
      const artifactPath = join(install, 'artifact.json')
      await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`)
      const servicePath = join(import.meta.dir, 'ManagedPostgresService.ts')
      const operationsPath = join(import.meta.dir, 'PostgresOperations.ts')
      const code = `
        const { readFile } = await import('node:fs/promises')
        const { ManagedPostgresOperations } = await import(${JSON.stringify(`file://${operationsPath}`)})
        const { ManagedPostgresService } = await import(${JSON.stringify(`file://${servicePath}`)})
        const artifact = JSON.parse(await readFile(process.env.BASIS_ARTIFACT, 'utf8'))
        class KillingService extends ManagedPostgresService {
          async markCutover(phase) {
            await super.markCutover(phase)
            if (phase === 'detached') process.kill(process.pid, 'SIGKILL')
          }
        }
        const operations = new ManagedPostgresOperations({
          artifact,
          installation: process.env.BASIS_INSTALL,
        }, new KillingService(process.env.BASIS_INSTALL))
        await operations.upgrade('postgres:17-alpine')
      `
      child = Bun.spawn([process.execPath, '-e', code], {
        cwd: install,
        env: {
          ...process.env,
          BASIS_ARTIFACT: artifactPath,
          BASIS_INSTALL: install,
        },
        stderr: 'pipe',
        stdout: 'pipe',
      })
      const exit = await child.exited
      if (exit === 0) throw new Error('cutover child unexpectedly completed')
      const service = new ManagedPostgresService(install)
      const connection = await service.ensure(false)
      const sql = new BunSQL(connection.ownerUrl)
      try {
        await sql.connect()
        expect((await DDL.readiness(sql, artifact)).ready).toBe(true)
      } finally {
        await sql.close()
      }
      await expect(stat(join(install, '.basis', 'database', 'cutover.json')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (child && child.exitCode === null) {
        child.kill()
        await child.exited.catch(() => undefined)
      }
      const clean = removeService(install)
      await rm(install, { force: true, recursive: true })
      expect(clean).toBe(true)
      await expect(stat(install)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 240_000)
})
