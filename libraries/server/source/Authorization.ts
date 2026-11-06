import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { runAsActor } from './ActorContext'
import type { Database } from './Database'
import { AUTHORIZATION_ADMIN, AUTHORIZATION_SECRET } from './Database'
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
    this.#actorSecret = options.actorSecret ?? options.database[AUTHORIZATION_SECRET]?.()
    this.#appRole = options.appRole ?? DEFAULT_APP_ROLE
    this.#database = options.database
    this.definitions = Authorization.combine(options.definitions)
  }

  /**
   * Run work under one request actor.
   * @param actor - Canonical User id or null.
   * @param callback - Work that may open native transactions.
   * @returns The callback result.
   */
  run<T>(actor: string | null, callback: () => T): T {
    return runAsActor({ id: actor }, callback)
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
  async login(
    provider: string,
    subject: string,
    profile: { readonly displayName?: string, readonly email?: string } = {},
  ): Promise<string | null> {
    if (!provider || !subject) return null
    const rows = await this.#database.sql<{ id: string | null }[]>`
      SELECT basis.login_identity(
        ${provider}, ${subject}, ${profile.email ?? null}, ${profile.displayName ?? null}
      ) AS "id"
    `
    return rows[0]?.id ?? null
  }

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
    const admin = await this.#database[AUTHORIZATION_ADMIN]?.()
    if (!admin) throw new Error('Authorization requires an administrative database connection')
    try {
      await admin.sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto').simple()
      await this.definitions.createTables(admin.sql)
      await this.#createInternalSchema(admin.sql)
      await this.#createSecurityIndexes(admin.sql)
      await this.#writeActorSecret(admin.sql)
      await this.#seedRoles(admin.sql)
      await this.#seedAncestors(admin.sql)
      await this.#createRLS(admin.sql)

      let userId: string | null = null
      if (options.provider && options.subject) {
        userId = await this.login(options.provider, options.subject, options)
        if (userId) await this.#assignRoleAdmin(userId, ADMIN_ROLE, admin.sql)
      }
      return { userId }
    } finally {
      await admin.close()
    }
  }

  /**
   * Inspect whether an actor has an action on one target row.
   * @param actor - Canonical User id or null.
   * @param action - Closed action.
   * @param target - Entity or relationship name.
   * @param row - Optional row projection.
   * @returns Whether the action is allowed.
   */
  async can(
    actor: string | null,
    action: Action | `${Action}`,
    target: string,
    row: Record<string, unknown> = {},
  ): Promise<boolean> {
    try {
      return await this.run(actor, () => this.#database.tx(async tx => {
        const rows = await tx<{ allowed: boolean }[]>`
          SELECT basis.authorized(${target}, ${action}, ${row}::jsonb) AS allowed
        `
        return rows[0]?.allowed === true
      }))
    } catch {
      return false
    }
  }

  /**
   * Create an application role. Requires `manage` on Role.
   * @param actor - Acting canonical User id.
   * @param key - Stable role key.
   * @param title - Human-readable role title.
   */
  async createRole(actor: string, key: string, title: string): Promise<void> {
    await this.#requireManage(actor, 'Role')
    if (!/^[a-z][a-z0-9_-]*$/.test(key)) throw new Error('Authorization: role key must be a lowercase identifier')
    if (!title) throw new Error('Authorization: role title is required')
    const id = randomUUID()
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`INSERT INTO "Entity" ("id", "name", "entity") VALUES (${id}, ${title}, 'Role')`
      await tx`INSERT INTO "Role" ("id", "key", "title") VALUES (${id}, ${key}, ${title})`
    }))
  }

  /**
   * Revoke one provider identity binding. Requires `manage` on ExternalIdentity.
   * @param actor - Acting canonical User id.
   * @param provider - Provider slug.
   * @param subject - Stable provider subject.
   */
  async revokeIdentity(actor: string, provider: string, subject: string): Promise<void> {
    await this.#requireManage(actor, 'ExternalIdentity')
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`
        UPDATE "ExternalIdentity" SET "revoked" = true
        WHERE "provider" = ${provider} AND "subject" = ${subject}
      `
    }))
  }

  /**
   * Assign a role to a User. Requires `manage` on `UserRole`; self-escalation is rejected.
   * @param actor - Acting canonical User id.
   * @param userId - User receiving the role.
   * @param role - Role key.
   */
  async assignRole(actor: string, userId: string, role: string): Promise<void> {
    if (actor === userId) throw new Error('Authorization: self role assignment is not allowed')
    await this.#requireManage(actor, 'UserRole')
    const roleId = await this.#roleId(role)
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`
        INSERT INTO "UserRole" ("user.id", "role.id")
        VALUES (${userId}, ${roleId})
        ON CONFLICT DO NOTHING
      `
    }))
  }

  /**
   * Remove a role from a User. Requires `manage` on `UserRole`.
   * @param actor - Acting canonical User id.
   * @param userId - User losing the role.
   * @param role - Role key.
   */
  async removeRole(actor: string, userId: string, role: string): Promise<void> {
    await this.#requireManage(actor, 'UserRole')
    const roleId = await this.#roleId(role)
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`DELETE FROM "UserRole" WHERE "user.id" = ${userId} AND "role.id" = ${roleId}`
    }))
  }

  /**
   * Create or update one authoritative grant. Requires `manage` on Grant.
   * @param actor - Acting canonical User id.
   * @param input - Grant input.
   */
  async grant(actor: string, input: GrantInput): Promise<void> {
    await this.#requireManage(actor, 'Grant')
    const action = actionValue(input.action)
    if (action === Action.Manage) {
      throw new Error('Authorization: manage grants require explicit bootstrap')
    }
    const predicate = this.#normalizePredicate(input.target, input.predicate)
    const roleId = await this.#roleId(input.role)
    const id = randomUUID()
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`INSERT INTO "Entity" ("id", "name", "entity") VALUES (${id}, 'Grant', 'Grant')`
      await tx`
        INSERT INTO "Grant" ("id", "role.id", "action", "target", "predicate")
        VALUES (${id}, ${roleId}, ${action}, ${input.target}, coalesce(${predicate}::jsonb, 'null'::jsonb))
      `
    }))
  }

  /**
   * Update one grant. Requires `manage` on Grant.
   * @param actor - Acting canonical User id.
   * @param grantId - Grant id.
   * @param input - New grant input.
   */
  async updateGrant(actor: string, grantId: string, input: GrantInput): Promise<void> {
    await this.#requireManage(actor, 'Grant')
    const action = actionValue(input.action)
    if (action === Action.Manage) throw new Error('Authorization: manage grants require explicit bootstrap')
    const predicate = this.#normalizePredicate(input.target, input.predicate)
    const roleId = await this.#roleId(input.role)
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`
        UPDATE "Grant"
        SET "role.id" = ${roleId}, "action" = ${action}, "target" = ${input.target},
          "predicate" = coalesce(${predicate}::jsonb, 'null'::jsonb)
        WHERE "id" = ${grantId}
      `
    }))
  }

  /**
   * Revoke one grant. Requires `manage` on Grant.
   * @param actor - Acting canonical User id.
   * @param grantId - Grant id.
   */
  async revoke(actor: string, grantId: string): Promise<void> {
    await this.#requireManage(actor, 'Grant')
    await this.run(actor, () => this.#database.tx(async tx => {
      await tx`DELETE FROM "Grant" WHERE "id" = ${grantId}`
      await tx`DELETE FROM "Entity" WHERE "id" = ${grantId} AND "entity" = 'Grant'`
    }))
  }

  /**
   * List effective grants for one actor. Requires `manage` on Grant.
   * @param actor - Acting canonical User id.
   * @param userId - User to inspect, or null for public.
   * @returns Effective grants.
   */
  async effective(actor: string, userId: string | null): Promise<EffectiveGrant[]> {
    await this.#requireManage(actor, 'Grant')
    return this.run(actor, () => this.#database.tx(async tx => {
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
    }))
  }

  async #requireManage(actor: string, target: string): Promise<void> {
    if (!await this.can(actor, Action.Manage, target)) {
      throw new Error(`Authorization denied: manage on ${target} is required`)
    }
  }

  async #roleId(role: string): Promise<string> {
    const rows = await this.#database.sql<{ id: string | null }[]>`
      SELECT basis.role_id(${role}) AS "id"
    `
    if (!rows[0]?.id) throw new Error(`Unknown role "${role}"`)
    return rows[0].id
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

  async #createInternalSchema(sql: BunSQL): Promise<void> {
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS basis;
      CREATE TABLE IF NOT EXISTS basis.secret (
        key text PRIMARY KEY,
        value text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS basis.entity_ancestor (
        entity text NOT NULL,
        ancestor text NOT NULL,
        PRIMARY KEY (entity, ancestor)
      );
      REVOKE ALL ON basis.secret FROM PUBLIC;
    `).simple()
  }

  async #createSecurityIndexes(sql: BunSQL): Promise<void> {
    await sql.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Role_key_key" ON "Role" ("key");
      CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIdentity_provider_subject_key"
        ON "ExternalIdentity" ("provider", "subject");
      CREATE INDEX IF NOT EXISTS "Grant_role_idx" ON "Grant" ("role.id");
      CREATE INDEX IF NOT EXISTS "UserRole_user_idx" ON "UserRole" ("user.id");
      CREATE INDEX IF NOT EXISTS "UserRole_role_idx" ON "UserRole" ("role.id");
    `).simple()
  }

  async #writeActorSecret(sql: BunSQL): Promise<void> {
    const secret = this.#actorSecret ?? this.#database[AUTHORIZATION_SECRET]?.()
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
    const rows: { ancestor: string, entity: string }[] = []
    for (const name of ['Entity', ...this.definitions.entities.map(entity => entity.name),
      ...this.definitions.relationships.map(relationship => relationship.name)]) {
      let current = name
      while (current !== 'Entity') {
        rows.push({ ancestor: current, entity: name })
        const definition = this.definitions.entity(current)
        if (!definition || definition.parent === current) break
        current = definition.parent
      }
      rows.push({ ancestor: 'Entity', entity: name })
    }
    for (const row of rows) {
      await sql`
        INSERT INTO basis.entity_ancestor ("entity", "ancestor")
        VALUES (${row.entity}, ${row.ancestor}) ON CONFLICT DO NOTHING
      `
    }
  }

  async #createRLS(sql: BunSQL): Promise<void> {
    await sql.unsafe(this.#functionDdl()).simple()
    const superuser = (await sql<{ superuser: boolean }[]>`
      SELECT r.rolsuper AS superuser
      FROM pg_roles r
      WHERE r.rolname = current_user
    `)[0]?.superuser === true
    const tables = [
      { entity: 'Entity', root: true, table: 'Entity' },
      ...this.definitions.entities.map(entity => ({ entity: entity.name, root: false, table: entity.name })),
      ...this.definitions.relationships.map(relationship => ({
        entity: relationship.name,
        root: false,
        table: relationship.name,
      })),
    ]
    for (const { entity, root, table } of tables) {
      const quoted = quote(table)
      const role = quote(this.#appRole)
      await sql.unsafe(`ALTER TABLE ${quoted} ENABLE ROW LEVEL SECURITY`).simple()
      if (superuser) await sql.unsafe(`ALTER TABLE ${quoted} FORCE ROW LEVEL SECURITY`).simple()
      await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoted} TO ${role}`).simple()
      for (const [action, policy] of [
        ['read', 'SELECT'],
        ['create', 'INSERT'],
        ['update', 'UPDATE'],
        ['delete', 'DELETE'],
      ] as const) {
        const name = `basis_${table.replaceAll(/[^A-Za-z0-9]/g, '_')}_${action}`
        const check = root
          ? `basis.authorized_root('${action}', to_jsonb(${quoted}))`
          : `basis.authorized('${entity}', '${action}', to_jsonb(${quoted}))`
        await sql.unsafe(`DROP POLICY IF EXISTS ${quote(name)} ON ${quoted}`).simple()
        const using = policy === 'INSERT' ? '' : ` USING (${check})`
        const withCheck = policy === 'INSERT' || policy === 'UPDATE' ? ` WITH CHECK (${check})` : ''
        await sql.unsafe(
          `CREATE POLICY ${quote(name)} ON ${quoted} FOR ${policy} TO ${role}${using}${withCheck}`,
        ).simple()
      }
    }
    await sql.unsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC').simple()
    await sql.unsafe(`REVOKE CREATE ON SCHEMA public FROM ${quote(this.#appRole)}`).simple()
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${quote(this.#appRole)}`).simple()
    await sql.unsafe(`GRANT USAGE ON SCHEMA basis TO ${quote(this.#appRole)}`).simple()
    const functions = [
      'basis.actor_id()',
      'basis.actor_active(text)',
      'basis.login_identity(text, text, text, text)',
      'basis.role_id(text)',
      'basis.matches(jsonb, jsonb)',
      'basis.authorized(text, text, jsonb)',
      'basis.authorized_create(text)',
      'basis.authorized_root(text, jsonb)',
    ].join(', ')
    await sql.unsafe(`REVOKE ALL ON FUNCTION ${functions} FROM PUBLIC`).simple()
    await sql.unsafe(
      'GRANT EXECUTE ON FUNCTION basis.actor_id(), basis.actor_active(text), ' +
      'basis.login_identity(text, text, text, text), basis.role_id(text), ' +
      'basis.matches(jsonb, jsonb), basis.authorized(text, text, jsonb), ' +
      `basis.authorized_root(text, jsonb) TO ${quote(this.#appRole)}`,
    ).simple()
  }

  #functionDdl(): string {
    return `
      CREATE OR REPLACE FUNCTION basis.actor_id() RETURNS text
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = basis, public, pg_temp AS $$
      DECLARE
        token text;
        parts text[];
        secret text;
        expected text;
        actor text;
        expires numeric;
      BEGIN
        token := current_setting('basis.actor', true);
        IF token IS NULL OR token = '' THEN RETURN NULL; END IF;
        parts := string_to_array(token, ':');
        IF array_length(parts, 1) <> 3 THEN RETURN NULL; END IF;
        expires := parts[2]::numeric;
        IF expires < extract(epoch FROM now()) THEN RETURN NULL; END IF;
        SELECT value INTO secret FROM basis.secret WHERE key = 'actor';
        IF secret IS NULL THEN RETURN NULL; END IF;
        expected := encode(
          hmac(convert_to(parts[1] || ':' || parts[2], 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'),
          'hex'
        );
        IF expected <> parts[3] THEN RETURN NULL; END IF;
        actor := convert_from(decode(parts[1], 'hex'), 'UTF8');
        RETURN actor;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END $$;

      CREATE OR REPLACE FUNCTION basis.matches(predicate jsonb, row_value jsonb) RETURNS boolean
      LANGUAGE plpgsql STABLE AS $$
      DECLARE
        op text;
        field text;
        value jsonb;
        actual jsonb;
        child jsonb;
        actor text;
      BEGIN
        IF predicate IS NULL OR predicate = 'null'::jsonb OR predicate = '{}'::jsonb THEN RETURN true; END IF;
        op := predicate->>'operator';
        IF op = '$and' THEN
          FOR child IN SELECT value FROM jsonb_array_elements(predicate->'filters') LOOP
            IF NOT basis.matches(child, row_value) THEN RETURN false; END IF;
          END LOOP;
          RETURN true;
        END IF;
        IF op = '$or' THEN
          FOR child IN SELECT value FROM jsonb_array_elements(predicate->'filters') LOOP
            IF basis.matches(child, row_value) THEN RETURN true; END IF;
          END LOOP;
          RETURN false;
        END IF;
        IF op = '$not' THEN
          RETURN NOT basis.matches(predicate->'filters'->0, row_value);
        END IF;
        field := predicate->>'field';
        value := predicate->'value';
        IF field IS NULL THEN RETURN false; END IF;
        actual := row_value -> field;
        IF value = '{"$actor":true}'::jsonb THEN
          actor := basis.actor_id();
          value := to_jsonb(actor);
        END IF;
        IF op = '$eq' THEN RETURN actual IS NOT DISTINCT FROM value; END IF;
        IF op = '$ne' THEN RETURN actual IS DISTINCT FROM value; END IF;
        IF op = '$lt' THEN RETURN actual < value; END IF;
        IF op = '$lte' THEN RETURN actual <= value; END IF;
        IF op = '$gt' THEN RETURN actual > value; END IF;
        IF op = '$gte' THEN RETURN actual >= value; END IF;
        IF op = '$empty' THEN
          RETURN actual IS NULL OR actual = '""'::jsonb OR actual = '[]'::jsonb OR actual = 'null'::jsonb;
        END IF;
        IF op = '$contains' THEN
          IF jsonb_typeof(actual) = 'array' THEN RETURN actual @> jsonb_build_array(value); END IF;
          RETURN (actual #>> '{}') LIKE '%' || (value #>> '{}') || '%';
        END IF;
        IF op = '$overlaps' THEN
          RETURN EXISTS (
            SELECT 1 FROM jsonb_array_elements(actual) item
            WHERE value ? (item #>> '{}')
          );
        END IF;
        IF op = '$sequenceEqual' THEN RETURN actual = value; END IF;
        RETURN false;
      END $$;

      CREATE OR REPLACE FUNCTION basis.role_id(role_key text)
      RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, basis, pg_temp AS $$
        SELECT "id" FROM "Role" WHERE "key" = role_key
      $$;

      CREATE OR REPLACE FUNCTION basis.actor_active(candidate text)
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, basis, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1
          FROM "User" u
          JOIN "ExternalIdentity" e ON e."user.id" = u."id"
          WHERE u."id" = candidate AND e."revoked" = false
        )
      $$;

      CREATE OR REPLACE FUNCTION basis.login_identity(
        provider_name text,
        provider_subject text,
        email_address text,
        display_name text
      )
      RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, basis, pg_temp AS $$
      DECLARE
        existing_revoked boolean;
        existing_user text;
        user_id text;
        identity_id text;
        user_name text;
      BEGIN
        IF provider_name IS NULL OR provider_name = '' OR provider_subject IS NULL OR provider_subject = '' THEN
          RETURN NULL;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(provider_name || ':' || provider_subject, 0));
        SELECT e."revoked", e."user.id" INTO existing_revoked, existing_user
        FROM "ExternalIdentity" e
        JOIN "User" u ON u."id" = e."user.id"
        WHERE e."provider" = provider_name AND e."subject" = provider_subject
        FOR UPDATE OF e;
        IF FOUND THEN
          IF existing_revoked THEN RETURN NULL; END IF;
          RETURN existing_user;
        END IF;
        user_id := gen_random_uuid()::text;
        user_name := coalesce(
          nullif(display_name, ''),
          nullif(email_address, ''),
          provider_name || ':' || provider_subject
        );
        INSERT INTO "Entity" ("id", "name", "entity") VALUES (user_id, user_name, 'User');
        INSERT INTO "User" ("id", "email", "displayName")
          VALUES (user_id, coalesce(email_address, ''), user_name);
        identity_id := gen_random_uuid()::text;
        INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (identity_id, provider_name || ':' || provider_subject, 'ExternalIdentity');
        INSERT INTO "ExternalIdentity" ("id", "provider", "subject", "revoked", "user.id")
          VALUES (identity_id, provider_name, provider_subject, false, user_id);
        RETURN user_id;
      END $$;

      CREATE OR REPLACE FUNCTION basis.authorized(target_entity text, requested_action text, row_value jsonb)
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, basis, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1
          FROM "Grant" g
          JOIN "Role" r ON r."id" = g."role.id"
          LEFT JOIN "UserRole" ur ON ur."role.id" = r."id"
          WHERE (r."key" = 'public' OR (basis.actor_id() IS NOT NULL AND ur."user.id" = basis.actor_id()))
            AND (
              g."action" = requested_action
              OR (g."action" = 'manage' AND (
                requested_action = 'manage'
                OR target_entity IN ('Role', 'Grant', 'UserRole', 'ExternalIdentity')
              ))
            )
            AND (g."target" = '*' OR g."target" = target_entity OR EXISTS (
              SELECT 1 FROM basis.entity_ancestor ea
              WHERE ea.entity = target_entity AND ea.ancestor = g."target"
            ))
            AND (g."predicate" IS NULL OR g."predicate" = 'null'::jsonb OR basis.matches(g."predicate", row_value))
        )
      $$;

      CREATE OR REPLACE FUNCTION basis.authorized_create(target_entity text)
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, basis, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1
          FROM "Grant" g
          JOIN "Role" r ON r."id" = g."role.id"
          LEFT JOIN "UserRole" ur ON ur."role.id" = r."id"
          WHERE (r."key" = 'public' OR (basis.actor_id() IS NOT NULL AND ur."user.id" = basis.actor_id()))
            AND (
              g."action" = 'create'
              OR (g."action" = 'manage' AND target_entity IN ('Role', 'Grant', 'UserRole', 'ExternalIdentity'))
            )
            AND (g."target" = '*' OR g."target" = target_entity OR g."target" = 'Entity' OR EXISTS (
              SELECT 1 FROM basis.entity_ancestor ea
              WHERE ea.entity = target_entity AND ea.ancestor = g."target"
            ))
        )
      $$;

      CREATE OR REPLACE FUNCTION basis.authorized_root(requested_action text, row_value jsonb)
      RETURNS boolean
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, basis, pg_temp AS $$
      DECLARE
        entity_name text;
        leaf jsonb;
      BEGIN
        entity_name := coalesce(row_value->>'entity', '');
        IF entity_name = '' THEN RETURN false; END IF;
        IF requested_action = 'create' THEN
          RETURN basis.authorized_create(entity_name);
        END IF;
        EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id = $1', entity_name)
          INTO leaf USING row_value->>'id';
        IF leaf IS NOT NULL THEN
          row_value := row_value || leaf;
        END IF;
        RETURN basis.authorized(entity_name, requested_action, row_value);
      END $$;
    `
  }
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

/**
 * Quote one PostgreSQL identifier.
 * @param identifier - Identifier.
 * @returns The quoted identifier.
 */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
