import type { SQL as BunSQL } from 'bun'
import { currentActor } from './ActorContext'
import type { Database } from './Database'
import { openAdmin } from './Database'
import type { Graph } from './Graph'
import { Action, ADMIN_ROLE_ID, PUBLIC_ROLE_ID } from './Graph'
import type { Filter } from './Predicate'

export { Action } from './Graph'

/** Options used to construct the authorization capability. */
export interface AuthorizationOptions {
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
  readonly #database: Database

  /**
   * Build the capability.
   * @param options - Database and canonical graph.
   */
  constructor(options: AuthorizationOptions) {
    this.#database = options.database
    this.graph = options.graph
  }

  /**
   * Resolve a verified canonical User id, failing closed when it is gone.
   * @param userId - Verified canonical id from the session.
   * @returns The live canonical id, or null.
   */
  async resolve(userId: string | null): Promise<string | null> {
    if (!userId) return null
    try {
      return await this.#database.tx(async tx => {
        const rows = await tx<{ id: string | null }[]>`
          SELECT basis.resolve_identity(${userId}) AS "id"
        `
        return rows[0]?.id ?? null
      })
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
    if (!options.provider || !options.subject) return { userId: null }
    const admin = await openAdmin(this.#database).catch(() => null)
    if (!admin) throw new Error('Authorization requires an administrative database connection')
    try {
      const userId = await this.#enrollIdentityWithSql(
        admin.sql,
        options.provider,
        options.subject,
        options,
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
      return { userId }
    } finally {
      await admin.close()
    }
  }

  /**
   * Map a provider identity to a canonical User, creating it once.
   *
   * The trusted server verifies the provider assertion before calling this
   * method. OAuth uses the restricted application path; bootstrap invokes the
   * same security-definer function through its administrative connection.
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
    return this.#database.tx(tx => this.#enrollIdentityWithSql(tx, provider, subject, profile))
  }

  /**
   * Execute the canonical enrollment function on one SQL connection.
   * @param sql - Transaction, request, or administrative SQL connection.
   * @param provider - Provider slug.
   * @param subject - Stable provider subject.
   * @param profile - Optional email and display name.
   * @param profile.displayName - Human-readable name.
   * @param profile.email - Email address.
   * @returns The canonical User id, or null when revoked.
   */
  async #enrollIdentityWithSql(
    sql: BunSQL,
    provider: string,
    subject: string,
    profile: { readonly displayName?: string, readonly email?: string } = {},
  ): Promise<string | null> {
    const rows = await sql<{ id: string | null }[]>`
SELECT basis.enroll_identity(${provider},
  ${subject},
  ${profile.displayName ?? null},
  ${profile.email ?? null} ) AS "id"
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
}
