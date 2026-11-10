import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { createDatabase, openAdmin } from './Database'
import { Graph } from './Graph'
import type { MigrationArtifact } from './Schema'
import { Server } from './Server'

const silent = new Logger({ silent: true })
const application = join(import.meta.dir, '..', '..', '..', 'testing', 'server', 'Application.tsx')

/**
 * Start one production Graph-backed server in an installation directory.
 * @param install - Installation root.
 * @param graph - Canonical application Graph.
 * @param artifact - Optional approved schema artifact.
 * @returns The started server.
 */
async function start(
  install: string,
  graph: Graph,
  artifact?: MigrationArtifact,
): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .graph(graph)
    .main(application)
    .root(install)
  if (artifact) server.migration(artifact)
  server.start({ development: false, hostname: '127.0.0.1', logger: silent, port: 0 })
  process.chdir(previous)
  return server
}

describe('Graph-backed production readiness', () => {
  test('requires an approved, current schema before reporting healthy', async () => {
    const install = tempDirectory('basis-readiness-')
    const previous = process.cwd()
    const graph = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
    })
    const database = (() => {
      process.chdir(install)
      return createDatabase({ authorization: true, entities: graph.definitions })
    })()
    try {
      await database.connect()
      const admin = await openAdmin(database)
      let artifact: MigrationArtifact
      try {
        artifact = await installSchema(admin.sql, graph, {
          appRole: 'basis_app',
          schema: 'public',
          superuser: true,
          version: `readiness-${randomUUID()}`,
        })
      } finally {
        await admin.close()
      }
      await database.close()

      const missing = await start(install, graph)
      try {
        await expect(missing.ready()).rejects.toThrow('approved migration artifact')
      } finally {
        await missing.shutdown()
      }

      const unapproved = await start(install, graph, {
        ...artifact,
        version: `${artifact.version}-tampered`,
      })
      try {
        await expect(unapproved.ready()).rejects.toThrow('checksum')
      } finally {
        await unapproved.shutdown()
      }

      const ready = await start(install, graph, artifact)
      try {
        await expect(ready.ready()).resolves.toBeUndefined()
      } finally {
        await ready.shutdown()
      }

      const divergentGraph = new Graph({
        entities: [{
          fields: [
            { field: 'title', type: 'String' },
            { field: 'extra', type: 'String' },
          ],
          name: 'Note',
        }],
      })
      const divergent = await start(install, divergentGraph, artifact)
      try {
        await expect(divergent.ready()).rejects.toThrow('does not match the configured Graph')
      } finally {
        await divergent.shutdown()
      }

      const stillReady = await start(install, graph, artifact)
      try {
        await expect(stillReady.ready()).resolves.toBeUndefined()
      } finally {
        await stillReady.shutdown()
      }

      const driftedDatabase = (() => {
        process.chdir(install)
        return createDatabase({ authorization: true, entities: graph.definitions })
      })()
      try {
        await driftedDatabase.connect()
        const driftedAdmin = await openAdmin(driftedDatabase)
        try {
          await driftedAdmin.sql.unsafe('ALTER TABLE "Note" ADD COLUMN "drift" text').simple()
        } finally {
          await driftedAdmin.close()
        }
      } finally {
        await driftedDatabase.close()
      }
      const drifted = await start(install, graph, artifact)
      try {
        await expect(drifted.ready()).rejects.toThrow('Schema readiness failed')
      } finally {
        await drifted.shutdown()
      }
    } finally {
      process.chdir(previous)
      removeService(install)
    }
  }, 240_000)
})
