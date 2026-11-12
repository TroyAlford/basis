import { run } from 'basis/configuration'
import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { runAsActor } from './ActorContext'
import { openAdmin } from './Database'
import { Graph } from './Graph'
import { ManagedPostgresService } from './ManagedPostgresService'
import { ManagedPostgresOperations } from './PostgresOperations'
import type { MigrationArtifact } from './Schema'
import { Server } from './Server'

const silent = new Logger({ silent: true })

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: 'String' }], name: 'User' },
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
      ],
      name: 'Article',
    },
  ],
  grants: [
    { action: 'manage', role: 'admin', target: '*' },
    { action: 'read', predicate: 'owner = $me', role: 'public', target: 'Article' },
  ],
})

/** One service that can fail the first source-container recreation. */
class FailingService extends ManagedPostgresService {
  failNextSource = false
  failRemoveContainer = false
  failRemoveVolume = false
  failStart = false
  failCandidateCleanup = false
  failRecoveryCleanup = false

  override async createContainer(
    name: string,
    volume: string,
    image: string,
    passwordFile: string,
  ): Promise<void> {
    if (this.failNextSource && name === this.containerName) {
      this.failNextSource = false
      throw new Error('injected cutover failure')
    }
    return super.createContainer(name, volume, image, passwordFile)
  }

  override async removeContainer(name = this.containerName): Promise<void> {
    if (this.failRemoveContainer && name === this.containerName) {
      this.failRemoveContainer = false
      throw new Error('injected container removal failure')
    }
    return super.removeContainer(name)
  }

  override async removeVolume(name = this.volumeName): Promise<void> {
    if (this.failRemoveVolume && name === this.volumeName) {
      this.failRemoveVolume = false
      throw new Error('injected volume removal failure')
    }
    if (this.failCandidateCleanup && name.startsWith('basis-restore-volume-')) {
      this.failCandidateCleanup = false
      throw new Error('injected candidate cleanup failure')
    }
    if (this.failRecoveryCleanup && name.includes('-recovery-')) {
      this.failRecoveryCleanup = false
      throw new Error('injected recovery cleanup failure')
    }
    return super.removeVolume(name)
  }

  override async startContainer(name = this.containerName): Promise<void> {
    if (this.failStart && name === this.containerName) {
      this.failStart = false
      throw new Error('injected source restart failure')
    }
    return super.startContainer(name)
  }
}

/**
 * Start one managed server in an installation directory.
 * @param install - Installation root.
 * @param artifact - Optional approved schema artifact.
 * @param image - PostgreSQL image.
 * @returns The started server.
 */
async function start(
  install: string,
  artifact: MigrationArtifact | undefined,
  image: string,
): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .graph(graph)
    .database({ image })
    .root(install)
  if (artifact) server.migration(artifact)
  server.start({ development: artifact === undefined, hostname: '127.0.0.1', logger: silent, port: 0 })
  try {
    await server.ready()
  } finally {
    process.chdir(previous)
  }
  return server
}

/**
 * Install the canonical Graph schema and return its approved artifact.
 * @param server - Connected server.
 * @returns The reviewed artifact.
 */
async function installArtifact(server: Server): Promise<MigrationArtifact> {
  const admin = await openAdmin(server.db)
  try {
    return await installSchema(admin.sql, graph, {
      appRole: 'basis_app',
      schema: 'public',
      superuser: true,
      version: `operations-${randomUUID()}`,
    })
  } finally {
    await admin.close()
  }
}

/**
 * Insert one article through the administrative owner.
 * @param server - Connected server.
 * @param id - Article id.
 * @param title - Article title.
 * @param owner - Owning canonical User id.
 */
async function insertArticle(server: Server, id: string, title: string, owner: string): Promise<void> {
  const admin = await openAdmin(server.db)
  try {
    await admin.sql.begin(async tx => {
      await tx`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${id}, ${title}, 'Article')
      `
      await tx`
        INSERT INTO "Article" ("id", "title", "owner.id")
        VALUES (${id}, ${title}, ${owner})
      `
    })
  } finally {
    await admin.close()
  }
}

/**
 * Assert the application role sees only the actor's own article.
 * @param server - Connected server.
 * @param actor - Canonical User id.
 * @param expected - Expected article projection.
 * @param expected.id - Expected article id.
 * @param expected.title - Expected article title.
 */
async function expectOwnArticle(
  server: Server,
  actor: string,
  expected: { readonly id: string, readonly title: string },
): Promise<void> {
  expect(await runAsActor({ id: actor }, () => server.db.query('Article', {
    fields: ['id', 'title'],
  }))).toEqual([expected])
}

/**
 * Prove an injected cutover failure leaves the previous source recoverable.
 * @param installRoot - Installation root.
 * @param artifact - Approved schema artifact.
 * @param service - Service with one injected failure.
 * @param actor - Canonical User id used for RLS readback.
 * @param expected - Expected article projection.
 * @param expected.id - Expected article id.
 * @param expected.title - Expected article title.
 * @param preserveVolumes - Whether recovery must preserve additional volumes.
 */
async function expectFailureRecovery(
  installRoot: string,
  artifact: MigrationArtifact,
  service: FailingService,
  actor: string,
  expected: { readonly id: string, readonly title: string },
  preserveVolumes = false,
): Promise<void> {
  const operations = new ManagedPostgresOperations({ artifact }, service)
  await expect(operations.upgrade('postgres:17-alpine'))
    .rejects.toThrow(/injected (cutover|container removal|volume removal|source restart) failure/)
  if (preserveVolumes) {
    const volumes = run('docker', [
      'volume', 'ls', '-q', '--filter', `label=basis.install=${installRoot}`,
    ], { logger: silent }).lines
    expect(volumes.some(name => name.includes('-recovery-'))).toBe(true)
    expect(volumes.some(name => name.startsWith('basis-restore-volume-'))).toBe(true)
  }
  const recovered = await start(installRoot, artifact, 'postgres:16.4-alpine')
  try {
    await expectOwnArticle(recovered, actor, expected)
  } finally {
    await recovered.shutdown()
  }
}

describe('Managed PostgreSQL operations', () => {
  test('recovers real Graph authorization data and preserves a restartable source', async () => {
    const installRoot = tempDirectory('basis-postgres-operations-')
    const previous = process.cwd()
    process.chdir(installRoot)
    const source = await start(installRoot, undefined, 'postgres:16.4-alpine')
    try {
      const artifact = await installArtifact(source)
      const authorization = source.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const admin = await authorization.bootstrap({
        displayName: 'Admin',
        email: 'admin@example.com',
        provider: 'test',
        subject: 'admin',
      })
      const user = await authorization.enrollIdentity('test', 'user', { email: 'user@example.com' })
      const other = await authorization.enrollIdentity('test', 'other', { email: 'other@example.com' })
      if (!admin.userId || !user || !other) throw new Error('canonical identity setup failed')
      const own = randomUUID()
      const foreign = randomUUID()
      await insertArticle(source, own, 'Own article', user)
      await insertArticle(source, foreign, 'Foreign article', other)
      await expectOwnArticle(source, user, { id: own, title: 'Own article' })

      const adminConnection = await openAdmin(source.db)
      try {
        const [backupRole] = await adminConnection.sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM pg_roles
          WHERE rolname = 'basis_backup'
        `
        expect(backupRole?.count).toBe(0)
      } finally {
        await adminConnection.close()
      }

      const operations = new ManagedPostgresOperations({ artifact })
      const backup = await operations.backup()
      expect(backup.artifactVersion).toBe(artifact.version)
      expect(backup.dataDigest).toMatch(/^[0-9a-f]{64}$/)
      expect((await stat(backup.path)).mode & 0o777).toBe(0o600)
      expect((await stat(backup.manifest)).mode & 0o777).toBe(0o600)
      for (const name of ['password', 'app-password']) {
        expect((await stat(join(installRoot, '.basis', 'database', name))).mode & 0o777).toBe(0o600)
      }
      await expect(stat(join(installRoot, '.basis', 'database', 'backup-password')))
        .rejects.toMatchObject({ code: 'ENOENT' })

      expect(await operations.restore(backup.path, { image: 'postgres:17-alpine' }))
        .toEqual({
          artifactVersion: artifact.version,
          dataDigest: backup.dataDigest,
          image: 'postgres:17-alpine',
          verified: true,
        })

      const damaged = `${backup.path}.damaged`
      const damagedManifest = `${damaged}.json`
      await copyFile(backup.path, damaged)
      await copyFile(backup.manifest, damagedManifest)
      const bytes = await readFile(damaged)
      bytes[0] = bytes[0] === 0 ? 1 : 0
      await writeFile(damaged, bytes)
      await expect(operations.restore(damaged, { image: 'postgres:17-alpine' }))
        .rejects.toThrow('checksum')
      await rm(damaged, { force: true })
      await rm(damagedManifest, { force: true })

      await source.shutdown()
      const upgraded = await operations.upgrade('postgres:17-alpine')
      expect(upgraded).toMatchObject({
        image: 'postgres:17-alpine',
        previousImage: 'postgres:16.4-alpine',
      })
      const upgradedServer = await start(installRoot, artifact, 'postgres:17-alpine')
      try {
        await expectOwnArticle(upgradedServer, user, { id: own, title: 'Own article' })
      } finally {
        await upgradedServer.shutdown()
      }

      await operations.rollback(backup.path, 'postgres:16.4-alpine')
      const rolledBack = await start(installRoot, artifact, 'postgres:16.4-alpine')
      try {
        await expectOwnArticle(rolledBack, user, { id: own, title: 'Own article' })
      } finally {
        await rolledBack.shutdown()
      }

      const failureCases: readonly [string, (service: FailingService) => void, boolean][] = [
        ['cutover', service => { service.failNextSource = true }, false],
      ]
      for (const [name, configure, preserveVolumes] of failureCases) {
        const service = new FailingService()
        configure(service)
        try {
          await expectFailureRecovery(
            installRoot,
            artifact,
            service,
            user,
            { id: own, title: 'Own article' },
            preserveVolumes,
          )
        } catch (error) {
          throw new Error(`failure case "${name}" did not recover`, { cause: error })
        }
      }

    } finally {
      process.chdir(previous)
      await source.shutdown()
      removeService(installRoot)
    }
  }, 300_000)
})
