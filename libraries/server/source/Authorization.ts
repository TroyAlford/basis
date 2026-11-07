import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { currentActor, signIdentity } from './ActorContext'
import type { Database } from './Database'
import { actorSecret, openAdmin } from './Database'
import type { EntityDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { EntityDefinitions, FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Predicate } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'

/** The closed authorization action vocabulary. */
export enum Action {
  Create = 'create',
  Delete = 'delete',
  Manage = 'manage',
  Read = 'read',
  Update = 'update',
}

/** The system security ontology, expressed through the one canonical model. */
const SECURITY_SOURCE = JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'email', type: 'String' },
        { field: 'displayName', type: 'String' },
      ],
      name: 'User',
    },
    {
      fields: [
        { field: 'key', type: 'String' },
        { field: 'title', type: 'String' },
      ],
      name: 'Role',
    },
    {
      fields: [
        { field: 'role', target: 'Role', type: 'Entity' },
        { field: 'action', type: 'String' },
        { field: 'target', type: 'String' },
        { field: 'predicate', type: 'JSON' },
      ],
      name: 'Grant',
    },
    {
      fields: [
        { field: 'provider', type: 'String' },
        { field: 'subject', type: 'String' },
        { field: 'revoked', type: 'Boolean' },
        { field: 'user', target: 'User', type: 'Entity' },
      ],
      name: 'ExternalIdentity',
    },
  ],
  relationships: [{
    between: [
      { field: 'user', inverse: 'roles', target: 'User' },
      { field: 'role', inverse: 'users', target: 'Role' },
    ],
    fields: [],
    name: 'UserRole',
  }],
})

/** System entity and relationship names reserved from application definitions. */
const SECURITY_NAMES = ['User', 'Role', 'Grant', 'ExternalIdentity', 'UserRole'] as const
/** Definitions produced by {@link Authorization.load}, which already include the system ontology. */
const LOADED_DEFINITIONS = new WeakSet<EntityDefinitions>()
/** The built-in principal for grants that apply to anonymous and signed-in requests. */
const PUBLIC_ROLE = 'public'
/** The built-in role that receives initial security administration. */
const ADMIN_ROLE = 'admin'
/** The reserved application role name used by managed PostgreSQL. */
const DEFAULT_APP_ROLE = 'basis_app'

/** Options used to construct the authorization capability. */
export interface AuthorizationOptions {
  /** Optional actor-token signing secret; managed PostgreSQL supplies one. */
  readonly actorSecret?: string,
  /** The restricted application login role; defaults to `basis_app`. */
  readonly appRole?: string,
  /** The server-owned database capability. */
  readonly database: Database,
  /** Optional application definitions to compose with the system ontology. */
  readonly definitions?: EntityDefinitions,
}

/** One grant input accepted by the authorization service. */
export interface GrantInput {
  /** Closed action. */
  readonly action: Action | `${Action}`,
  /** Optional validated row predicate. */
  readonly predicate?: Filter | Readonly<Record<string, unknown>> | string | null,
  /** Role key receiving the grant. */
  readonly role: string,
  /** Target entity name, a relationship name, or `*`. */
  readonly target: string,
}

/** One effective grant returned by inspection. */
export interface EffectiveGrant {
  /** Action. */
  readonly action: string,
  /** Grant id. */
  readonly id: string,
  /** Optional canonical predicate. */
  readonly predicate: Filter | null,
  /** Role key. */
  readonly role: string,
  /** Target entity or relationship name. */
  readonly target: string,
}

/** One bootstrap result. */
export interface BootstrapResult {
  /** Canonical User id when a bootstrap identity was supplied. */
  readonly userId: string | null,
}

/**
 * The single authorization capability.
 *
 * It owns the canonical security ontology, provider-to-User mapping, native
 * transaction actor binding, and the PostgreSQL RLS definitions.
 */
export class Authorization {
  /**
   * Compose the system security ontology with optional application definitions.
   * @param application - Optional application definitions.
   * @returns The combined canonical ontology.
   */
  static combine(application?: EntityDefinitions): EntityDefinitions {
    const security = securityDefinitions()
    if (!application) return security
    if (LOADED_DEFINITIONS.has(application)) return application
    for (const name of SECURITY_NAMES) {
      if (application.entity(name) || application.relationship(name)) {
        throw new Error(`Entity or relationship "${name}" is reserved by Basis authorization`)
      }
    }
    const combined = EntityDefinitions.combine(security, application)
    LOADED_DEFINITIONS.add(combined)
    return combined
  }

  /**
   * Load application definitions with the system security ontology available.
   *
   * Applications that reference `User` (or extend it) must load through this
   * method so the one canonical validator sees the complete ontology.
   * @param source - Application canonical JSON.
   * @returns Combined validated definitions.
   */
  static load(source: string): EntityDefinitions {
    const security = JSON.parse(SECURITY_SOURCE) as {
      entities: unknown[],
      relationships: unknown[],
    }
    const application = JSON.parse(source) as {
      entities?: unknown[],
      relationships?: unknown[],
    }
    const definitions = EntityDefinitions.load(JSON.stringify({
      entities: [...security.entities, ...(application.entities ?? [])],
      relationships: [...security.relationships, ...(application.relationships ?? [])],
    }))
    const user = definitions.entity('User')
    if (user) (user as { abstract: boolean }).abstract = false
    LOADED_DEFINITIONS.add(definitions)
    return definitions
  }

  /** The combined application and security ontology. */
  readonly definitions: EntityDefinitions
  readonly #actorSecret: string | undefined
  readonly #appRole: string
  readonly #database: Database

  /**
   * Build the capability.
   * @param options - Database and optional application definitions.
   */
  constructor(options: AuthorizationOptions) {
    this.#actorSecret = options.actorSecret ?? actorSecret(options.database)
    this.#appRole = options.appRole ?? DEFAULT_APP_ROLE
    this.#database = options.database
    this.definitions = Authorization.combine(options.definitions)
  }

  /**
   * Resolve a verified canonical User id, failing closed when the User is gone.
   * @param userId - Verified canonical id from the session.
   * @returns The live canonical id, or null.
   */
  async resolve(userId: string | null): Promise<string | null> {
    if (!userId) return null
    try {
      const rows = await this.#database.sql<{ id: string }[]>`
        SELECT ${userId}::text AS "id" WHERE basis.actor_active(${userId})
      `
      return rows[0]?.id ?? null
    } catch {
      return null
    }
  }

  /**
   * Map a provider identity to a canonical User, creating it once.
   * @param provider - Provider slug.
   * @param subject - Stable provider subject.
   * @param profile - Optional email and display name.
   * @param profile.displayName - Human-readable name.
   * @param profile.email - Email address.
   * @returns The canonical User id, or null when the binding is revoked.
   */
  /**
   * Explicit, operator-controlled bootstrap. Never called by OAuth login.
   * @param options - Optional first administrator identity.
   * @param options.displayName - Human-readable name.
   * @param options.email - Email address.
   * @param options.provider - Provider slug.
   * @param options.subject - Stable provider subject.
   * @returns The bootstrap result.
   */
  async bootstrap(options: {
    readonly displayName?: string,
    readonly email?: string,
    readonly provider?: string,
    readonly subject?: string,
  } = {}): Promise<BootstrapResult> {
    if (currentActor() !== undefined) {
      throw new Error('Authorization: bootstrap is only available outside request dispatch')
    }
    const admin = await openAdmin(this.#database).catch(() => null)
    if (!admin) throw new Error('Authorization requires an administrative database connection')
    try {
      await this.definitions.createTables(admin.sql)
      for (const statement of this.definitions.authorizationSchemaDdl()) {
        await admin.sql.unsafe(statement).simple()
      }
      await this.#writeActorSecret(admin.sql)
      await this.#seedRoles(admin.sql)
      await this.#seedAncestors(admin.sql)
      await this.#createRLS(admin.sql)

      let userId: string | null = null
      if (options.provider && options.subject) {
        userId = await enrollIdentity(this.#database, options.provider, options.subject, options)
        if (userId) await this.#assignRoleAdmin(userId, ADMIN_ROLE, admin.sql)
      }
      return { userId }
    } finally {
      await admin.close()
    }
  }

  /**
   * Inspect whether an actor has an action on one target row.
   * @param action - Closed action.
   * @param target - Entity or relationship name.
   * @param row - Optional row projection.
   * @returns Whether the action is allowed.
   */
  async can(
    action: Action | `${Action}`,
    target: string,
    row: Record<string, unknown> = {},
  ): Promise<boolean> {
    this.#requestActor()
    try {
      return await this.#database.tx(async tx => {
        const rows = await tx<{ allowed: boolean }[]>`
          SELECT basis.authorized(${target}, ${action}, ${row}::jsonb) AS allowed
        `
        return rows[0]?.allowed === true
      })
    } catch {
      return false
    }
  }

  /**
   * Create an application role. Requires `manage` on Role.
   * @param key - Stable role key.
   * @param title - Human-readable role title.
   */
  async createRole(key: string, title: string): Promise<void> {
    await this.#requireManage('Role')
    await this.#database.tx(async tx => {
      await tx`SELECT basis.create_role(${key}, ${title})`
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
      await tx`SELECT basis.revoke_identity(${provider}, ${subject})`
    })
  }

  /**
   * Assign a role to a User. Requires `manage` on `UserRole`; self-escalation is rejected.
   * @param userId - User receiving the role.
   * @param role - Role key.
   */
  async assignRole(userId: string, role: string): Promise<void> {
    const actor = this.#requestActor()
    if (actor.id === userId) throw new Error('Authorization: self role assignment is not allowed')
    await this.#requireManage('UserRole')
    await this.#database.tx(async tx => {
      await tx`SELECT basis.assign_role(${userId}, ${role})`
    })
  }

  /**
   * Remove a role from a User. Requires `manage` on `UserRole`.
   * @param userId - User losing the role.
   * @param role - Role key.
   */
  async removeRole(userId: string, role: string): Promise<void> {
    await this.#requireManage('UserRole')
    await this.#database.tx(async tx => {
      await tx`SELECT basis.remove_role(${userId}, ${role})`
    })
  }

  /**
   * Create or update one authoritative grant. Requires `manage` on Grant.
   * @param input - Grant input.
   */
  async grant(input: GrantInput): Promise<void> {
    await this.#requireManage('Grant')
    const action = actionValue(input.action)
    if (action === Action.Manage) {
      throw new Error('Authorization: manage grants require explicit bootstrap')
    }
    const predicate = this.#normalizePredicate(input.target, input.predicate)
    await this.#database.tx(async tx => {
      await tx`SELECT basis.create_grant(${input.role}, ${action}, ${input.target}, ${predicate}::jsonb)`
    })
  }

  /**
   * Update one grant. Requires `manage` on Grant.
   * @param grantId - Grant id.
   * @param input - New grant input.
   */
  async updateGrant(grantId: string, input: GrantInput): Promise<void> {
    await this.#requireManage('Grant')
    const action = actionValue(input.action)
    if (action === Action.Manage) throw new Error('Authorization: manage grants require explicit bootstrap')
    const predicate = this.#normalizePredicate(input.target, input.predicate)
    await this.#database.tx(async tx => {
      await tx`SELECT basis.update_grant(${grantId}, ${input.role}, ${action}, ${input.target}, ${predicate}::jsonb)`
    })
  }

  /**
   * Revoke one grant. Requires `manage` on Grant.
   * @param grantId - Grant id.
   */
  async revoke(grantId: string): Promise<void> {
    await this.#requireManage('Grant')
    await this.#database.tx(async tx => {
      await tx`SELECT basis.revoke_grant(${grantId})`
    })
  }

  /**
   * List effective grants for one actor. Requires `manage` on Grant.
   * @param userId - User to inspect, or null for public.
   * @returns Effective grants.
   */
  async effective(userId: string | null): Promise<EffectiveGrant[]> {
    await this.#requireManage('Grant')
    return this.#database.tx(async tx => {
      const rows = await tx<{
        action: string,
        id: string,
        predicate: Filter | null,
        role: string,
        target: string,
      }[]>`
        SELECT g."id", r."key" AS "role", g."action", g."target", g."predicate"
        FROM "Grant" g
        JOIN "Role" r ON r."id" = g."role.id"
        LEFT JOIN "UserRole" ur ON ur."role.id" = r."id"
        WHERE (r."key" = ${PUBLIC_ROLE} OR ur."user.id" = ${userId})
        ORDER BY r."key", g."target", g."action", g."id"
      `
      return rows
    })
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

  async #assignRoleAdmin(userId: string, role: string, sql: BunSQL): Promise<void> {
    const roleRows = await sql<{ id: string }[]>`
      SELECT "id"
      FROM "Role"
      WHERE "key" = ${role}
    `
    const roleId = roleRows[0]?.id
    if (!roleId) throw new Error(`Unknown role "${role}"`)
    await sql`
      INSERT INTO "UserRole" ("user.id", "role.id")
      VALUES (${userId}, ${roleId}) ON CONFLICT DO NOTHING
    `
  }

  #normalizePredicate(
    target: string,
    input: GrantInput['predicate'],
  ): Filter | null {
    if (input === null || input === undefined) return null
    if (target === '*') throw new Error('Authorization: a wildcard grant cannot carry a predicate')
    if (target === 'Entity' && (input === null || input === undefined)) return null
    const definition = this.definitions.entity(target)
    if (!definition) {
      if (this.definitions.relationship(target) && (input === null || input === undefined)) return null
      throw new Error(`Authorization: unknown target entity "${target}"`)
    }
    const entity = policyDefinition(definition)
    const normalizedInput = replaceActorOperand(input)
    const filter = typeof normalizedInput === 'string'
      ? QueryNormalizer.normalize(entity, normalizedInput, name => policyField(entity, name))
      : Predicate.normalize(entity, normalizedInput, name => policyField(entity, name))
    if (!filter) return null
    restoreActorOperand(filter)
    assertPolicySafe(filter, definition)
    return filter
  }

  async #writeActorSecret(sql: BunSQL): Promise<void> {
    const secret = this.#actorSecret ?? actorSecret(this.#database)
    if (!secret) throw new Error('Authorization actor secret is not configured')
    await sql`
      INSERT INTO basis.secret ("key", "value")
      VALUES ('actor', ${secret}) ON CONFLICT ("key") DO
      UPDATE
      SET "value" = EXCLUDED."value"
    `
  }

  async #seedRoles(sql: BunSQL): Promise<void> {
    await sql.begin(async tx => {
      for (const [key, name] of [[PUBLIC_ROLE, 'Public'], [ADMIN_ROLE, 'Administrator']] as const) {
        const existing = await tx<{ id: string }[]>`
          SELECT "id" FROM "Role" WHERE "key" = ${key}
        `
        if (existing[0]) continue
        const id = randomUUID()
        await tx`INSERT INTO "Entity" ("id", "name", "entity") VALUES (${id}, ${name}, 'Role')`
        await tx`
          INSERT INTO "Role" ("id", "key", "title")
          VALUES (${id}, ${key}, ${name})
        `
      }
      const roleRows = await tx<{ id: string }[]>`SELECT "id" FROM "Role" WHERE "key" = ${ADMIN_ROLE}`
      const roleId = roleRows[0]?.id
      if (!roleId) throw new Error('Authorization: administrator role was not seeded')
      const grants = await tx<{ id: string }[]>`
        SELECT "id" FROM "Grant"
        WHERE "role.id" = ${roleId} AND "action" = 'manage' AND "target" = '*'
      `
      if (!grants[0]) {
        const id = randomUUID()
        await tx`INSERT INTO "Entity" ("id", "name", "entity") VALUES (${id}, 'Grant', 'Grant')`
        await tx`
          INSERT INTO "Grant" ("id", "role.id", "action", "target", "predicate")
          VALUES (${id}, ${roleId}, 'manage', '*', 'null'::jsonb)
        `
      }
    })
  }

  async #seedAncestors(sql: BunSQL): Promise<void> {
    const rows: { ancestor: string, depth: number, entity: string }[] = []
    for (const name of ['Entity', ...this.definitions.entities.map(entity => entity.name),
      ...this.definitions.relationships.map(relationship => relationship.name)]) {
      let current = name
      let depth = 0
      while (current !== 'Entity') {
        rows.push({ ancestor: current, depth, entity: name })
        depth += 1
        const definition = this.definitions.entity(current)
        if (!definition || definition.parent === current) break
        current = definition.parent
      }
      rows.push({ ancestor: 'Entity', depth, entity: name })
    }
    for (const row of rows) {
      await sql`
        INSERT INTO basis.entity_ancestor ("entity", "ancestor", "depth")
        VALUES (${row.entity}, ${row.ancestor}, ${row.depth}) ON CONFLICT ("entity", "ancestor") DO
        UPDATE
        SET "depth" = EXCLUDED."depth"
      `
    }
  }

  async #createRLS(sql: BunSQL): Promise<void> {
    const superuser = (await sql<{ superuser: boolean }[]>`
      SELECT r.rolsuper AS superuser
      FROM pg_roles r
      WHERE r.rolname = current_user
    `)[0]?.superuser === true
    for (const statement of this.definitions.authorizationDdl(this.#appRole, superuser)) {
      await sql.unsafe(statement).simple()
    }
  }

}

/**
 * Enroll a provider assertion that the server has already verified.
 *
 * This is intentionally a module capability rather than a public method on
 * `server.auth`; direct restricted-role SQL cannot produce the signed proof.
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
  if (!provider || !subject) return null
  const secret = actorSecret(database)
  if (!secret) throw new Error('Authorization actor secret is not configured')
  const [domain] = await database.sql<{ domain: string }[]>`
    SELECT current_database()::text AS domain
  `
  if (!domain?.domain) throw new Error('PostgreSQL did not expose a database domain')
  const proof = signIdentity(provider, subject, secret, domain.domain)
  const rows = await database.sql<{ id: string | null }[]>`
SELECT basis.login_identity(${provider},
  ${subject},
  ${profile.email ?? null},
  ${profile.displayName ?? null},
  ${proof} ) AS "id"
  `
  return rows[0]?.id ?? null
}

/**
 * Load the fixed system security ontology.
 * @returns Validated security definitions.
 */
function securityDefinitions(): EntityDefinitions {
  return EntityDefinitions.load(SECURITY_SOURCE)
}

/**
 * A policy-facing entity view over effective fields.
 * @param definition - Validated entity.
 * @returns Entity-shaped policy scope.
 */
function policyDefinition(definition: EntityDefinition): EntityDefinition {
  const fields: unknown[] = []
  for (const field of definition.effectiveFields) {
    if (field.type === FieldType.Entity) {
      fields.push({ name: `${field.name}.id`, type: FieldType.ID })
    } else {
      fields.push(field)
    }
  }
  return { ...definition, fields: fields as EntityDefinition['fields'] }
}

/**
 * Resolve one policy field.
 * @param entity - Policy-shaped entity.
 * @param name - Logical field.
 * @returns The scalar or JSON field.
 */
function policyField(entity: EntityDefinition, name: string): QueryFieldDefinition {
  const field = entity.fields.find(candidate => candidate.name === name)
  if (!field) throw new Error(`Authorization: unknown field "${entity.name}.${name}"`)
  if (field.type === FieldType.Entity || field.type === FieldType.Inverse) {
    throw new Error(`Authorization: reference field "${entity.name}.${name}" is not policy-safe`)
  }
  return field as QueryFieldDefinition
}

/** The placeholder used during typed normalization of the actor operand. */
const ACTOR_PLACEHOLDER = '00000000-0000-0000-0000-000000000000'

/**
 * Replace the typed actor sentinel in a predicate input.
 * @param input - Predicate input.
 * @returns Input with the actor sentinel replaced by a valid ID placeholder.
 */
function replaceActorOperand(input: GrantInput['predicate']): GrantInput['predicate'] {
  if (typeof input === 'string' || input === null || input === undefined) return input
  return replaceActorValue(input) as Readonly<Record<string, unknown>>
}

/**
 * Recursively replace an actor sentinel value.
 * @param value - Input value.
 * @returns The replacement value.
 */
function replaceActorValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceActorValue)
  if (value === null || typeof value !== 'object') return value
  if ((value as Record<string, unknown>).$actor === true) return ACTOR_PLACEHOLDER
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceActorValue(child)]))
}

/**
 * Restore actor sentinel values after typed normalization.
 * @param filter - Canonical filter tree.
 */
function restoreActorOperand(filter: Filter): void {
  if ('filters' in filter) {
    for (const child of filter.filters) restoreActorOperand(child)
    return
  }
  if ('value' in filter && filter.value === ACTOR_PLACEHOLDER) {
    (filter as { value: unknown }).value = { $actor: true }
  }
}

/**
 * Reject policy constructs the RLS evaluator cannot safely represent.
 * @param filter - Canonical filter.
 * @param definition - Target entity.
 */
function assertPolicySafe(filter: Filter, definition: EntityDefinition): void {
  if ('filters' in filter) {
    if ('field' in filter) {
      throw new Error(`Authorization: collection policy for "${definition.name}" is not policy-safe`)
    }
    for (const child of filter.filters) assertPolicySafe(child, definition)
    return
  }
  if (!('field' in filter) || !('operator' in filter)) {
    throw new Error(`Authorization: policy for "${definition.name}" is not a comparable field filter`)
  }
  if (!Object.values(Operator.Comparison).includes(filter.operator as Operator.Comparison)) {
    throw new Error(`Authorization: operator "${filter.operator}" is not policy-safe`)
  }
  if (filter.operator === Operator.Comparison.Overlaps || filter.operator === Operator.Comparison.SequenceEqual) {
    throw new Error(`Authorization: operator "${filter.operator}" is not policy-safe`)
  }
}

/**
 * Normalize one action literal.
 * @param action - Action input.
 * @returns The validated action.
 */
function actionValue(action: Action | `${Action}`): Action {
  if (!Object.values(Action).includes(action as Action)) {
    throw new Error(`Authorization: unknown action "${action}"`)
  }
  return action as Action
}
