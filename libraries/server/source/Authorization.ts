import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { currentActor } from './ActorContext'
import type { AdminConnection, Database } from './Database'
import { openAdmin } from './Database'
import type { EntityDefinitions, QueryFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import type { Graph } from './Graph'
import { Action, ADMIN_ROLE_ID, PUBLIC_ROLE_ID } from './Graph'
import type { Filter } from './Predicate'

export { Action } from './Graph'

/** The restricted application login role used by managed PostgreSQL. */
const DEFAULT_APP_ROLE = 'basis_app'

/** Options used to construct the authorization capability. */
export interface AuthorizationOptions {
  /** The restricted application login role; defaults to `basis_app`. */
  readonly appRole?: string,
  /** The server-owned database capability. */
  readonly database: Database,
  /** The canonical application graph. */
  readonly graph: Graph,
}

/** One effective grant returned by inspection. */
export interface EffectiveGrant {
  /** Action. */
  readonly action: string,
  /** Optional canonical predicate. */
  readonly predicate: Filter | null,
  /** Role id. */
  readonly role: string,
  /** Target entity or relationship. */
  readonly target: string,
}

/** One bootstrap result. */
export interface BootstrapResult {
  /** Canonical User id when a bootstrap identity was supplied. */
  readonly userId: string | null,
}

/**
 * The graph-backed authorization capability.
 *
 * Enforcement is PostgreSQL RLS compiled from the graph. This class owns only
 * the explicit bootstrap/administration boundary and provider mapping; it
 * never evaluates ordinary authorization in JavaScript.
 */
export class Authorization {
  /** The canonical graph that owns roles and permissions. */
  readonly graph: Graph
  /** The combined application and security ontology. */
  readonly definitions: EntityDefinitions
  readonly #appRole: string
  readonly #database: Database

  /**
   * Build the capability.
   * @param options - Database, graph, and restricted application role.
   */
  constructor(options: AuthorizationOptions) {
    this.#appRole = options.appRole ?? DEFAULT_APP_ROLE
    this.#database = options.database
    this.graph = options.graph
    this.definitions = options.graph.definitions
  }

  /**
   * Resolve a verified canonical User id, failing closed when it is gone.
   * @param userId - Verified canonical id from the session.
   * @returns The live canonical id, or null.
   */
  async resolve(userId: string | null): Promise<string | null> {
    if (!userId) return null
    try {
      const rows = await this.#database.sql<{ id: string | null }[]>`
        SELECT basis.resolve_identity(${userId}) AS "id"
      `
      return rows[0]?.id ?? null
    } catch {
      return null
    }
  }

  /**
   * Explicit, operator-controlled bootstrap. Never called by OAuth login.
   * @param options - Optional first administrator identity and role.
   * @param options.displayName - Human-readable name.
   * @param options.email - Email address.
   * @param options.provider - Provider slug.
   * @param options.role - Role granted to the bootstrap identity.
   * @param options.subject - Stable provider subject.
   * @returns The bootstrap result.
   */
  async bootstrap(options: {
    readonly displayName?: string,
    readonly email?: string,
    readonly provider?: string,
    readonly role?: string,
    readonly subject?: string,
  } = {}): Promise<BootstrapResult> {
    if (currentActor() !== undefined) {
      throw new Error('Authorization: bootstrap is only available outside request dispatch')
    }
    const admin = await openAdmin(this.#database).catch(() => null)
    if (!admin) throw new Error('Authorization requires an administrative database connection')
    try {
      await this.definitions.createTables(admin.sql)
      const superuser = (await admin.sql<{ superuser: boolean }[]>`
        SELECT r.rolsuper AS superuser
        FROM pg_roles r
        WHERE r.rolname = current_user
      `)[0]?.superuser === true
      for (const statement of this.graph.authorizationDdl(this.#appRole, superuser)) {
        await admin.sql.unsafe(statement).simple()
      }
      await this.#seedRoles(admin.sql)
      let userId: string | null = null
      if (options.provider && options.subject) {
        userId = await enrollIdentityWithAdmin(
          admin,
          options.provider,
          options.subject,
          options,
          this.#userEntity(),
        )
        if (userId) {
          const role = this.graph.role(options.role ?? ADMIN_ROLE_ID)
          if (role) {
            await admin.sql`
              INSERT INTO "UserRole" ("user.id", "role.id")
              VALUES (${userId}, ${role.id}) ON CONFLICT DO NOTHING
            `
          }
        }
      }
      return { userId }
    } finally {
      await admin.close()
    }
  }

  /**
   * Map a provider identity to a canonical User, creating it once.
   *
   * The trusted server verifies the provider assertion before calling this
   * method. Identity creation uses the short-lived administrative connection,
   * never the restricted request role.
   * @param provider - Provider slug.
   * @param subject - Stable provider subject.
   * @param profile - Optional email and display name.
   * @param profile.displayName - Human-readable name.
   * @param profile.email - Email address.
   * @returns The canonical User id, or null when the binding is revoked.
   */
  async enrollIdentity(
    provider: string,
    subject: string,
    profile: { readonly displayName?: string, readonly email?: string } = {},
  ): Promise<string | null> {
    const rows = await this.#database.sql<{ id: string | null }[]>`
      SELECT basis.enroll_identity(
        ${provider},
        ${subject},
        ${profile.displayName ?? null},
        ${profile.email ?? null}
      ) AS "id"
    `
    return rows[0]?.id ?? null
  }

  /**
   * Inspect whether an actor has an action on one row through compiled SQL.
   * @param action - Closed action.
   * @param target - Entity or relationship name.
   * @param row - Optional row projection, including its canonical id.
   * @returns Whether PostgreSQL's compiled policy expression allows it.
   */
  async can(
    action: Action | `${Action}`,
    target: string,
    row: { readonly id?: string } & Record<string, unknown> = {},
  ): Promise<boolean> {
    this.#requestActor()
    const expression = this.graph.accessExpression(action, target, row)
    if (!expression) return false
    try {
      return await this.#database.tx(async tx => {
        const rows = await tx.unsafe<{ allowed: boolean }[]>(
          `SELECT (${expression}) AS allowed`,
        )
        return rows[0]?.allowed === true
      })
    } catch {
      return false
    }
  }

  /**
   * Assign a graph-defined role to a User. Requires `manage` on UserRole.
   * @param userId - User receiving the role.
   * @param role - Role id or name.
   */
  async assignRole(userId: string, role: string): Promise<void> {
    const actor = this.#requestActor()
    if (actor.id === userId) throw new Error('Authorization: self role assignment is not allowed')
    await this.#requireManage('UserRole')
    const details = this.graph.role(role)
    if (!details) throw new Error(`Authorization: unknown role "${role}"`)
    await this.#database.tx(async tx => {
      await tx`
        INSERT INTO "UserRole" ("user.id", "role.id")
        VALUES (${userId}, ${details.id}) ON CONFLICT DO NOTHING
      `
    })
  }

  /**
   * Remove a graph-defined role from a User. Requires `manage` on UserRole.
   * @param userId - User losing the role.
   * @param role - Role id or name.
   */
  async removeRole(userId: string, role: string): Promise<void> {
    await this.#requireManage('UserRole')
    const details = this.graph.role(role)
    if (!details) throw new Error(`Authorization: unknown role "${role}"`)
    await this.#database.tx(async tx => {
      await tx`
        DELETE FROM "UserRole"
        WHERE "user.id" = ${userId} AND "role.id" = ${details.id}
      `
    })
  }

  /**
   * Revoke one provider identity binding. Requires `manage` on ExternalIdentity.
   * @param provider - Provider slug.
   * @param subject - Stable provider subject.
   */
  async revokeIdentity(provider: string, subject: string): Promise<void> {
    await this.#requireManage('ExternalIdentity')
    await this.#database.tx(async tx => {
      await tx`
        UPDATE "ExternalIdentity"
        SET "revoked" = true
        WHERE "provider" = ${provider} AND "subject" = ${subject}
      `
    })
  }

  /**
   * List graph grants effective for one User, including Public grants.
   * @param userId - User to inspect, or null for anonymous.
   * @returns Effective grants.
   */
  async effective(userId: string | null): Promise<EffectiveGrant[]> {
    await this.#requireManage('Role')
    const admin = await openAdmin(this.#database)
    try {
      const rows = await admin.sql<{ role: string }[]>`
        SELECT "role.id" AS "role"
        FROM "UserRole"
        WHERE "user.id" = ${userId}
      `
      const roleIds = new Set(rows.map(row => row.role))
      return this.graph.grants
        .filter(grant => grant.role === PUBLIC_ROLE_ID || roleIds.has(grant.role))
        .map(grant => ({
          action: grant.action,
          predicate: grant.predicate,
          role: grant.role,
          target: grant.target,
        }))
    } finally {
      await admin.close()
    }
  }

  #userEntity(): string {
    const user = this.graph.definitions.entity('User')
    if (!user) return 'User'
    if (!user.abstract) return 'User'
    const leaf = this.graph.definitions.entities.find(entity => {
      let current = entity
      while (current.parent !== 'Entity') {
        const parent = this.graph.definitions.entity(current.parent)
        if (!parent) return false
        if (parent.name === 'User') return !entity.abstract
        current = parent
      }
      return false
    })
    return leaf?.name ?? 'User'
  }

  #requestActor(): { readonly id: string | null } {
    const actor = currentActor()
    if (!actor) throw new Error('Authorization: no verified request actor is bound')
    return actor
  }

  async #requireManage(target: string): Promise<void> {
    if (!await this.can(Action.Manage, target)) {
      throw new Error(`Authorization denied: manage on ${target} is required`)
    }
  }

  async #seedRoles(sql: BunSQL): Promise<void> {
    await sql.begin(async tx => {
      for (const role of this.graph.roles) {
        if (role.id === PUBLIC_ROLE_ID) continue
        const existing = await tx<{ id: string }[]>`
          SELECT "id" FROM "Role" WHERE "id" = ${role.id}
        `
        if (existing[0]) {
          await tx`
            UPDATE "Role" SET "description" = ${role.description ?? ''}
            WHERE "id" = ${role.id}
          `
          await tx`
            UPDATE "Entity" SET "name" = ${role.name}, "entity" = 'Role'
            WHERE "id" = ${role.id}
          `
          continue
        }
        await tx`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${role.id}, ${role.name}, 'Role')
        `
        await tx`
          INSERT INTO "Role" ("id", "description")
          VALUES (${role.id}, ${role.description ?? ''})
        `
      }
    })
  }
}

/**
 * Enroll a provider assertion that the server has already verified.
 * @param database - Restricted database capability.
 * @param provider - Verified provider slug.
 * @param subject - Verified stable provider subject.
 * @param profile - Optional email and display name.
 * @param profile.displayName - Human-readable name.
 * @param profile.email - Email address.
 * @returns The canonical User id, or null when the binding is revoked.
 */
export async function enrollIdentity(
  database: Database,
  provider: string,
  subject: string,
  profile: { readonly displayName?: string, readonly email?: string } = {},
): Promise<string | null> {
  const rows = await database.sql<{ id: string | null }[]>`
SELECT basis.enroll_identity(${provider},
  ${subject},
  ${profile.displayName ?? null},
  ${profile.email ?? null} ) AS "id"
  `
  return rows[0]?.id ?? null
}

/**
 * Enroll a verified provider subject through the bootstrap connection.
 * @param admin - Short-lived administrative connection.
 * @param provider - Provider slug.
 * @param subject - Stable provider subject.
 * @param profile - Optional identity profile.
 * @param profile.displayName - Human-readable name.
 * @param profile.email - Email address.
 * @param userEntity - Concrete canonical User leaf table.
 * @returns Canonical User id, or null when revoked.
 */
async function enrollIdentityWithAdmin(
  admin: AdminConnection,
  provider: string,
  subject: string,
  profile: { readonly displayName?: string, readonly email?: string } = {},
  userEntity = 'User',
): Promise<string | null> {
  if (!provider || !subject) return null
  const sql = admin.sql
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${provider}:${subject}`}, 0))`
    const [existing] = await tx<{ id: string, revoked: boolean }[]>`
      SELECT e."user.id" AS id, e."revoked" AS revoked
      FROM "ExternalIdentity" e
      WHERE e."provider" = ${provider} AND e."subject" = ${subject}
      FOR UPDATE
    `
    if (existing) return existing.revoked ? null : existing.id
    const userId = randomUUID()
    const name = profile.displayName || profile.email || `${provider}:${subject}`
    await tx`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${userId}, ${name}, ${userEntity})
    `
    const user = await userFields(tx)
    const columns = ['"id"', ...user.map(field => `"${field.name.replaceAll('"', '""')}"`)]
    const values = [userId, ...user.map(field => (field.name === 'email' ? profile.email ?? '' : ''))]
    const placeholders = values.map((_value, index) => `$${index + 1}`).join(', ')
    await tx.unsafe(`INSERT INTO "User" (${columns.join(', ')}) VALUES (${placeholders})`, values)
    if (userEntity !== 'User') {
      await tx.unsafe(`INSERT INTO ${quoteName(userEntity)} ("id") VALUES ($1)`, [userId])
    }
    const identityId = randomUUID()
    await tx`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${identityId}, ${`${provider}:${subject}`}, 'ExternalIdentity')
    `
    await tx`
      INSERT INTO "ExternalIdentity" ("id", "provider", "subject", "revoked", "user.id")
      VALUES (${identityId}, ${provider}, ${subject}, false, ${userId})
    `
    return userId
  })
}

/**
 * Quote one PostgreSQL identifier.
 * @param name - Identifier text.
 * @returns Quoted identifier.
 */
function quoteName(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Discover optional application User fields that can receive provider profile data.
 * @param sql - Transaction client.
 * @returns Fields other than `id`.
 */
async function userFields(sql: BunSQL): Promise<readonly QueryFieldDefinition[]> {
  const rows = await sql<{ field: string, type: string }[]>`
    SELECT column_name AS field, data_type AS type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog',
      'information_schema') AND table_name = 'User' AND column_name <> 'id'
    ORDER BY ordinal_position
  `
  return rows.map(row => ({
    name: row.field,
    type: row.type === 'boolean'
      ? FieldType.Boolean
      : row.type === 'text'
        ? FieldType.String
        : FieldType.JSON,
  } as QueryFieldDefinition))
}
