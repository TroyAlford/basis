import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import type { MigrationResolution, PhysicalModel, PhysicalSchema } from '../source/Schema'
import { DDL } from '../source/Schema'

/** Options for installing a canonical model through the reviewed DDL path. */
export interface InstallSchemaOptions {
  /** Restricted application role used by graph security objects. */
  readonly appRole?: string,
  /** Previous model represented by the live schema, when upgrading. */
  readonly previous?: PhysicalModel,
  /** Previous compiled physical artifact, when available. */
  readonly previousPhysical?: PhysicalSchema,
  /** Explicit resolutions required by review. */
  readonly resolutions?: readonly MigrationResolution[],
  /** Schema selected for the migration artifact. */
  readonly schema?: string,
  /** Whether provisioning can force owner RLS. */
  readonly superuser?: boolean,
  /** Unique artifact version; generated when omitted. */
  readonly version?: string,
}

/**
 * Install or upgrade a canonical model through the one reviewed DDL path.
 *
 * This is test and fixture support only; application installation must call
 * the same `DDL.plan`, `DDL.review`, and `DDL.apply` operations explicitly.
 * @param sql - Trusted SQL connection with schema privileges.
 * @param desired - Model to install.
 * @param options - Install options.
 * @returns The reviewed artifact.
 */
export async function installSchema(
  sql: BunSQL,
  desired: PhysicalModel,
  options: InstallSchemaOptions = {},
): Promise<ReturnType<typeof DDL.review>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const actual = await DDL.introspect(sql)
      const plan = DDL.plan({
        actual,
        appRole: options.appRole,
        desired,
        previous: options.previous,
        previousPhysical: options.previousPhysical,
        superuser: options.superuser,
      })
      const artifact = DDL.review(plan, {
        appRole: options.appRole,
        resolutions: options.resolutions,
        schema: options.schema,
        superuser: options.superuser,
        version: options.version ?? `test-${randomUUID()}`,
      })
      if (artifact.operations.length > 0) await DDL.apply(sql, artifact)
      return artifact
    } catch (error) {
      const starting = typeof error === 'object' && error !== null
        && (error as { errno?: string }).errno === '57P03'
      if (!starting || attempt >= 3) throw error
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
}
