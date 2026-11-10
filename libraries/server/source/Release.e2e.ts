import { tempDirectory } from 'basis/testing'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { createDatabase, openAdmin } from './Database'
import { Graph } from './Graph'
import { DatabaseRelease, loadRelease } from './Release'
import type { MigrationArtifact } from './Schema'
import { DDL } from './Schema'

/**
 * Build a migration artifact from one live model to another.
 * @param current - Current Graph.
 * @param next - Proposed Graph.
 * @param install - Installation root.
 * @returns The reviewed artifact.
 */
async function nextArtifact(current: Graph, next: Graph, install: string): Promise<MigrationArtifact> {
  const previous = process.cwd()
  process.chdir(install)
  const database = createDatabase({ authorization: true, entities: current.definitions })
  try {
    await database.connect()
    const admin = await openAdmin(database)
    try {
      await admin.sql.unsafe('SET search_path TO "public"').simple()
      const actual = await DDL.introspect(admin.sql)
      expect(actual.tables.map(table => table.name)).toContain('Note')
      const plan = DDL.plan({
        actual,
        appRole: 'basis_app',
        desired: next,
        previous: current,
        previousPhysical: current.physicalSchema('basis_app', true),
        superuser: true,
      })
      return DDL.review(plan, {
        appRole: 'basis_app',
        resolutions: plan.operations
          .filter(operation => operation.risk === 'data')
          .map(operation => ({
            approved: true,
            operationId: operation.id,
            sql: operation.sql,
          })),
        schema: 'public',
        superuser: true,
        version: `next-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      })
    } finally {
      await admin.close()
    }
  } finally {
    process.chdir(previous)
    await database.close()
  }
}

/**
 * Write one release directory.
 * @param directory - Target directory.
 * @param version - Application release version.
 * @param artifacts - Artifacts in order.
 */
async function writeRelease(
  directory: string,
  version: string,
  artifacts: readonly MigrationArtifact[],
): Promise<void> {
  await mkdir(directory, { recursive: true })
  const migrations: string[] = []
  for (const artifact of artifacts) {
    const filename = `${artifact.version}.json`
    migrations.push(filename)
    await writeFile(join(directory, filename), `${JSON.stringify(artifact, null, 2)}\n`)
  }
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({ migrations, version }, null, 2)}\n`)
}

/**
 * Read readiness for a Graph on the managed source.
 * @param install - Installation root.
 * @param graph - Graph to check.
 * @param artifact - Approved artifact.
 * @returns Whether the source matches.
 */
async function sourceReady(
  install: string,
  graph: Graph,
  artifact: MigrationArtifact,
): Promise<boolean> {
  const previous = process.cwd()
  process.chdir(install)
  const database = createDatabase({ authorization: true, entities: graph.definitions })
  try {
    await database.connect()
    const admin = await openAdmin(database)
    try {
      return (await DDL.readiness(admin.sql, artifact)).ready
    } finally {
      await admin.close()
    }
  } finally {
    process.chdir(previous)
    await database.close()
  }
}

const installs: string[] = []

afterEach(() => {
  for (const install of installs.splice(0)) removeService(install)
})

describe('versioned database releases', () => {
  test('stages migrations on a candidate, backs up, and exposes a truthful result', async () => {
    const install = tempDirectory('basis-release-')
    installs.push(install)
    const previous = process.cwd()
    const graphA = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
    })
    const graphB = new Graph({
      entities: [{
        fields: [
          { field: 'title', type: 'String' },
          { field: 'extra', type: 'String' },
        ],
        name: 'Note',
      }],
    })
    process.chdir(install)
    const database = createDatabase({ authorization: true, entities: graphA.definitions })
    let artifactA: MigrationArtifact
    try {
      await database.connect()
      const admin = await openAdmin(database)
      try {
        artifactA = await installSchema(admin.sql, graphA, {
          appRole: 'basis_app',
          schema: 'public',
          superuser: true,
          version: '0001-initial',
        })
        expect((await DDL.introspect(admin.sql)).tables.length).toBeGreaterThan(0)
        expect((await DDL.readiness(admin.sql, artifactA)).ready).toBe(true)
      } finally {
        await admin.close()
      }
    } finally {
      process.chdir(previous)
      await database.close()
    }
    const artifactB = await nextArtifact(graphA, graphB, install)
    const releaseDirectory = join(install, 'migrations')
    await writeRelease(releaseDirectory, '2.0.0', [artifactA, artifactB])

    const release = new DatabaseRelease({
      graph: graphB,
      installation: install,
      migrations: releaseDirectory,
    })
    const plan = await release.plan()
    expect(plan.applied).toHaveLength(1)
    expect(plan.pending).toHaveLength(1)
    expect(plan.upToDate).toBe(false)

    const result = await release.apply()
    expect(result.changed).toBe(true)
    expect(result.applied).toEqual([artifactB.version])
    expect(result.backup?.artifactVersion).toBe(artifactA.version)
    expect(await sourceReady(install, graphB, artifactB)).toBe(true)

    const noop = await release.apply()
    expect(noop.changed).toBe(false)
    expect(noop.applied).toEqual([])
    expect(noop.backup?.artifactVersion).toBe(artifactB.version)

    const missing = join(install, 'migrations-missing')
    await writeRelease(missing, '2.0.0', [artifactA])
    await expect(loadRelease(missing, graphB)).rejects.toThrow('do not reach the configured Graph')

    const tampered = join(install, 'migrations-tampered')
    await mkdir(tampered, { recursive: true })
    await writeFile(join(tampered, `${artifactB.version}.json`), `${JSON.stringify({
      ...artifactB,
      operations: [],
    }, null, 2)}\n`)
    await writeFile(join(tampered, 'manifest.json'), `${JSON.stringify({
      migrations: [`${artifactB.version}.json`],
      version: '2.0.0',
    }, null, 2)}\n`)
    await expect(loadRelease(tampered, graphB)).rejects.toThrow('checksum')

    const lock = join(install, '.basis', 'database', 'release.lock')
    await writeFile(lock, `${process.pid}\n`, { mode: 0o600 })
    await expect(release.apply()).rejects.toThrow('already locked')
    await unlink(lock)
  }, 240_000)

  test('a failed candidate leaves the previous release live', async () => {
    const install = tempDirectory('basis-release-failure-')
    installs.push(install)
    const previous = process.cwd()
    const graphA = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
    })
    const graphB = new Graph({
      entities: [{
        fields: [
          { field: 'title', type: 'String' },
          { field: 'extra', type: 'String' },
        ],
        name: 'Note',
      }],
    })
    const graphC = new Graph({
      entities: [{
        fields: [
          { field: 'title', type: 'String' },
          { field: 'extra', type: 'String' },
          { field: 'third', type: 'String' },
        ],
        name: 'Note',
      }],
    })
    process.chdir(install)
    const database = createDatabase({ authorization: true, entities: graphA.definitions })
    let artifactA: MigrationArtifact
    try {
      await database.connect()
      const admin = await openAdmin(database)
      try {
        artifactA = await installSchema(admin.sql, graphA, {
          appRole: 'basis_app',
          schema: 'public',
          superuser: true,
          version: '0001-initial',
        })
      } finally {
        await admin.close()
      }
    } finally {
      process.chdir(previous)
      await database.close()
    }
    const artifactB = await nextArtifact(graphA, graphB, install)
    const releaseB = join(install, 'migrations-b')
    await writeRelease(releaseB, '2.0.0', [artifactA, artifactB])
    expect((await new DatabaseRelease({ graph: graphB, installation: install, migrations: releaseB }).apply()).changed)
      .toBe(true)

    process.chdir(install)
    const current = createDatabase({ authorization: true, entities: graphB.definitions })
    let artifactC: MigrationArtifact
    try {
      await current.connect()
      const admin = await openAdmin(current)
      try {
        await admin.sql.unsafe('SET search_path TO "public"').simple()
        const plan = DDL.plan({
          actual: await DDL.introspect(admin.sql),
          appRole: 'basis_app',
          desired: graphC,
          previous: graphB,
          previousPhysical: graphB.physicalSchema('basis_app', true),
          superuser: true,
        })
        const operation = plan.operations.find(candidate => candidate.kind === 'add-column') ?? plan.operations[0]
        artifactC = DDL.review(plan, {
          appRole: 'basis_app',
          resolutions: [{
            approved: true,
            operationId: operation.id,
            sql: 'SELECT * FROM "missing_release_table"',
          }],
          schema: 'public',
          superuser: true,
          version: '0003-third',
        })
      } finally {
        await admin.close()
      }
    } finally {
      process.chdir(previous)
      await current.close()
    }
    const releaseC = join(install, 'migrations-c')
    await writeRelease(releaseC, '3.0.0', [artifactA, artifactB, artifactC])
    await expect(new DatabaseRelease({
      graph: graphC,
      installation: install,
      migrations: releaseC,
    }).apply()).rejects.toThrow()
    expect(await sourceReady(install, graphB, artifactB)).toBe(true)
  }, 240_000)
})
