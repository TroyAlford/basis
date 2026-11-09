import { createHash } from 'node:crypto'
import type { EntityDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { EntityDefinitions, FieldType, identityDefinition, isCanonicalUUID } from './EntityDefinitions'
import type { AuthoredDocument, AuthoredEntity, AuthoredRelationship } from './GraphAuthoring'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Predicate } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { PhysicalFunction, PhysicalGrant, PhysicalIndex, PhysicalPolicy, PhysicalSchema, PhysicalTable } from './Schema'
import type { QueryScope } from './SQL'
import { SQL } from './SQL'

/** The closed authorization action vocabulary. */
export enum Action {
  Create = 'create',
  Delete = 'delete',
  Manage = 'manage',
  Read = 'read',
  Update = 'update',
}

/** The built-in principal used by grants that apply to every request. */
export const PUBLIC_ROLE_ID = 'public'
/** The stable identifier for the graph's built-in administrator role. */
export const ADMIN_ROLE_ID = '00000000-0000-0000-0000-000000000001'
/** The restricted application role used by managed PostgreSQL. */
const DEFAULT_APP_ROLE = 'basis_app'

/** Human-readable role metadata. */
export interface RoleDetails {
  /** Optional role description. */
  readonly description?: string,
  /** Mutable human-readable role name. */
  readonly name: string,
}

/** One graph role with its stable identifier. */
export interface GraphRole extends RoleDetails {
  /** Stable canonical UUID identity. */
  readonly id: string,
}

/** Role authoring forms normalized to one canonical role list. */
export type RoleSource =
  | Readonly<Record<string, RoleDetails>>
  | ReadonlyMap<string, RoleDetails>
  | readonly GraphRole[]

/** One graph-defined role/action/row permission. */
export interface GrantDefinition {
  /** Closed action. */
  readonly action: Action | `${Action}`,
  /** Optional validated row predicate. */
  readonly predicate?: Filter | Readonly<Record<string, unknown>> | string | null,
  /** Role id or role name receiving the grant. */
  readonly role: string,
  /** Target entity name, relationship name, `Entity`, or `*`. */
  readonly target: string,
}

/** One normalized grant retained by the graph. */
export interface GraphGrant {
  /** Closed action. */
  readonly action: Action,
  /** Canonical predicate, or null for an unconditional grant. */
  readonly predicate: Filter | null,
  /** Canonical role id. */
  readonly role: string,
  /** Target entity, relationship, `Entity`, or `*`. */
  readonly target: string,
}

/** Canonical graph authoring options. */
export interface GraphOptions {
  /** Application ontology as JSON text, a document, or an entity array. */
  readonly entities?: AuthoredDocument | readonly AuthoredEntity[] | string,
  /** Graph-defined permission declarations. */
  readonly grants?: readonly GrantDefinition[],
  /** Application relationships when `entities` is an entity array. */
  readonly relationships?: readonly AuthoredRelationship[],
  /** Role authoring forms and stable identifiers. */
  readonly roles?: RoleSource,
  /** Application schema used by compiled security functions; defaults to public. */
  readonly schema?: string,
}

/** The system security ontology shared by every graph. */
const SYSTEM_DOCUMENT: AuthoredDocument = {
  entities: [
    { fields: [], name: 'User' },
    { fields: [{ field: 'description', type: 'String' }], name: 'Role' },
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
}

/** System names reserved from application declarations. */
const RESERVED_NAMES = new Set(['Role', 'ExternalIdentity', 'UserRole'])
/** Security entities whose `manage` grant means controlled administration. */
const MANAGED_ENTITIES = new Set(['Role', 'UserRole', 'ExternalIdentity'])
/** The built-in administrator role. */
const ADMIN_ROLE: GraphRole = { id: ADMIN_ROLE_ID, name: 'Administrator' }
/** The built-in public principal. */
const PUBLIC_ROLE: GraphRole = { id: PUBLIC_ROLE_ID, name: 'Public' }
/**
 * The one application-facing canonical graph.
 *
 * The graph owns the composed ontology, stable roles and permission declarations.
 * It compiles those declarations into the same typed physical schema that the
 * DDL planner and PostgreSQL introspection consume. Loading a graph is pure.
 */
export class Graph {
  /** The combined application and security ontology. */
  readonly definitions: EntityDefinitions
  /** Canonical roles, including the built-in public principal. */
  readonly roles: readonly GraphRole[]
  /** Canonical graph-defined permissions. */
  readonly grants: readonly GraphGrant[]
  readonly #rolesById: ReadonlyMap<string, GraphRole>
  readonly #rolesByName: ReadonlyMap<string, GraphRole>
  readonly #schema: string

  /**
   * Build and validate the graph.
   * @param options - Application ontology, roles, and grants.
   */
  constructor(options: GraphOptions = {}) {
    const application = normalizeGraphInput(options)
    const entities = application.entities
    const relationships = application.relationships ?? []
    for (const entity of entities) {
      const name = entityName(entity)
      if (RESERVED_NAMES.has(name)) {
        throw new Error(`Entity "${name}" is reserved by Basis authorization`)
      }
    }
    const hasUser = entities.some(entity => entityName(entity) === 'User')
    const security = SYSTEM_DOCUMENT.entities ?? []
    const allEntities = [
      ...security.filter(entity => hasUser === false || entityName(entity) !== 'User'),
      ...entities,
    ]
    this.definitions = EntityDefinitions.fromDocument({
      ...application,
      entities: allEntities,
      relationships: [...(SYSTEM_DOCUMENT.relationships ?? []), ...relationships],
    })
    this.roles = normalizeRoles(options.roles)
    this.#schema = options.schema ?? 'public'
    this.#rolesById = new Map(this.roles.map(role => [role.id, role]))
    this.#rolesByName = new Map(this.roles.map(role => [role.name, role]))
    this.grants = (options.grants ?? []).map(grant => this.#normalizeGrant(grant))
    this.#assertPolicyTargets()
  }

  /**
   * Resolve one role by canonical id, authored alias, or name.
   * @param role - Role id or name.
   * @returns The role, or undefined.
   */
  role(role: string): GraphRole | undefined {
    const id = role === 'admin' ? ADMIN_ROLE_ID : role
    return this.#rolesById.get(id) ??
      this.#rolesByName.get(role) ??
      this.#rolesById.get(roleIdentity(role))
  }

  /**
   * Compile the graph's security objects into the one physical representation.
   * @param appRole - Restricted application login role.
   * @param superuser - Whether provisioning can force owner RLS.
   * @param includeAuthorization - Whether to include graph security objects.
   * @returns The desired physical schema.
   */
  physicalSchema(
    appRole = DEFAULT_APP_ROLE,
    superuser = false,
    includeAuthorization = true,
  ): PhysicalSchema {
    const base = this.definitions.physicalSchema(appRole, superuser, false)
    if (!includeAuthorization) return base
    const tables: PhysicalTable[] = base.tables.map(table => ({
      ...table,
      forceRowSecurity: superuser,
      indexes: [
        ...table.indexes,
        ...this.#indexes().filter(index => (
          index.table === table.name && !table.indexes.some(existing => existing.name === index.name)
        )),
      ],
      rowSecurity: true,
    }))
    const policies = this.#policies(appRole)
    const hasRoleDdl = this.#hasRoleFunction()
    const hasRole: PhysicalFunction = {
      body: /\$\$([\s\S]*?)\$\$/u.exec(hasRoleDdl)?.[1]?.trim() ?? '',
      lifecycle: false,
      name: 'basis.has_role',
      required: ['basis.has_role'],
      searchPath: this.#searchPath(),
      securityDefiner: true,
      signature: 'role_id text',
      sql: hasRoleDdl,
    }
    return {
      ...base,
      extensions: ['pg_trgm'],
      functions: [
        ...base.functions,
        hasRole,
        ...this.#policyFunctions(),
        ...this.#identityFunctions(),
      ],
      grants: this.#grants(appRole),
      policies,
      roles: this.roles
        .filter(role => role.id !== PUBLIC_ROLE_ID)
        .map(role => ({
          ...(role.description === undefined ? {} : { description: role.description }),
          id: role.id,
          name: role.name,
        })),
      schemas: ['basis'],
      tables,
    }
  }

  /**
   * Compile the graph's bootstrap DDL. This never executes it.
   * @param appRole - Restricted application login role.
   * @param superuser - Whether provisioning can force owner RLS.
   * @returns Ordered security DDL.
   */
  authorizationDdl(appRole = DEFAULT_APP_ROLE, superuser = false): readonly string[] {
    const role = quoteIdentifier(appRole)
    const schema = this.physicalSchema(appRole, superuser)
    const statements: string[] = ['CREATE SCHEMA IF NOT EXISTS basis']
    for (const index of this.#indexes()) statements.push(index.sql)
    for (const fn of schema.functions) {
      if (!fn.lifecycle) statements.push(fn.sql)
    }
    for (const table of schema.tables) {
      const quoted = quoteIdentifier(table.name)
      statements.push(`ALTER TABLE ${quoted} ENABLE ROW LEVEL SECURITY`)
      if (superuser) statements.push(`ALTER TABLE ${quoted} FORCE ROW LEVEL SECURITY`)
    }
    statements.push('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
    statements.push(`REVOKE CREATE ON SCHEMA public FROM ${role}`)
    statements.push(`GRANT USAGE ON SCHEMA public TO ${role}`)
    statements.push(`GRANT USAGE ON SCHEMA basis TO ${role}`)
    for (const grant of schema.grants ?? []) statements.push(grant.sql)
    for (const policy of schema.policies) {
      statements.push(`DROP POLICY IF EXISTS ${quoteIdentifier(policy.name)} ON ${quoteIdentifier(policy.table)}`)
      statements.push(policy.sql)
    }
    return [...new Set(statements)]
  }

  /**
   * Compile one authorization expression for an action and target.
   *
   * The expression is PostgreSQL SQL, not a JavaScript access decision. It is
   * used by the narrow administration capability and by real tests.
   * @param action - Closed action.
   * @param target - Entity, relationship, or `Entity`.
   * @param row - Optional row identity.
   * @param row.id - Canonical row id.
   * @returns SQL expression, or null when no grant can apply.
   */
  accessExpression(
    action: Action | `${Action}`,
    target: string,
    row: { readonly id?: string } & Record<string, unknown> = {},
  ): string | null {
    const normalized = actionValue(action)
    if (normalized === Action.Manage) return this.#manageExpression(target)
    if (normalized === Action.Create) return this.createExpression(target, row)
    if (target === 'Entity') {
      const expression = this.#entityRootExpression(normalized)
      return expression === null
        ? null
        : `EXISTS (SELECT 1 FROM "Entity" WHERE ${expression})`
    }
    const entity = this.#policyEntity(target)
    if (!entity) return null
    const relationship = this.definitions.relationship(target)
    const leaves = relationship
      ? [target]
      : this.definitions.concreteDescendants(target).map(descendant => descendant.name)
    const conditions: string[] = []
    for (const leaf of leaves) {
      const table = quoteIdentifier(leaf)
      const alias = `__access_${conditions.length}`
      const predicate = relationship
        ? this.#relationshipExpression(target, normalized, alias)
        : this.#leafExpression(leaf, normalized, alias, false)
      if (!predicate) continue
      conditions.push(
        `EXISTS (SELECT 1 FROM ${table} AS ${quoteIdentifier(alias)} ` +
        `WHERE ${quoteIdentifier(alias)}.${quoteIdentifier('id')} = ${literal(row.id ?? '')} ` +
        `AND ${predicate})`,
      )
    }
    if (conditions.length === 0) return null
    return `(${conditions.join(' OR ')})`
  }

  /**
   * Compile a create-permission expression against proposed row values.
   * @param target - Entity or relationship being created.
   * @param row - Proposed new-row values.
   * @returns SQL boolean expression, or null.
   */
  createExpression(target: string, row: Record<string, unknown> = {}): string | null {
    const entity = this.#policyEntity(target)
    if (!entity) return null
    const targets = new Set(['*', ...this.#ancestry(target)])
    const conditions: string[] = []
    for (const grant of this.grants) {
      if (!targets.has(grant.target)) continue
      const actionMatches = grant.action === Action.Create
        || (MANAGED_ENTITIES.has(target) && grant.action === Action.Manage)
      if (!actionMatches) continue
      const role = roleCondition(grant.role)
      const predicate = grant.predicate
        ? this.#compilePredicateForRow(grant, row)
        : 'TRUE'
      conditions.push(`(${role} AND ${predicate})`)
    }
    return conditions.length === 0 ? null : `(${conditions.join(' OR ')})`
  }

  #compilePredicateForRow(grant: GraphGrant, row: Record<string, unknown>): string {
    const entity = grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target)
    if (!entity) throw new Error(`Graph: unknown predicate target "${grant.target}"`)
    const valueFor = (name: string): unknown => {
      if (Object.hasOwn(row, name)) return row[name]
      const root = name.split('.', 1)[0] ?? name
      if (Object.hasOwn(row, root)) {
        const value = row[root]
        if (value && typeof value === 'object' && 'id' in value) {
          return (value as { id?: unknown }).id
        }
        return value
      }
      return undefined
    }
    const scope: QueryScope = {
      array: name => {
        const field = policyField(entity, name)
        if (field.type !== FieldType.Array) return undefined
        return {
          expression: literal(valueFor(field.name)),
          field,
          member: {
            ...(field.items.format ? { format: field.items.format } : {}),
            name: field.name,
            type: field.items.type,
          },
        }
      },
      definition: entity,
      expression: field => literal(valueFor(field.name)),
      field: name => policyField(entity, name),
    }
    const where = SQL.where(this.definitions, entity.name, grant.predicate as Filter, scope)
    return `(${inline(where.sql.replace(/^WHERE\s+/u, ''), where.values)})`
  }

  /**
   * Compile the role/action expression used by `manage` administration.
   * @param target - Managed target.
   * @returns SQL expression or null.
   */
  manageExpression(target: string): string | null {
    return this.#manageExpression(target)
  }

  #assertPolicyTargets(): void {
    for (const grant of this.grants) {
      if (grant.target === '*') {
        if (grant.predicate) throw new Error('Graph: a wildcard grant cannot carry a predicate')
        continue
      }
      if (grant.target === 'Entity') continue
      if (!this.definitions.entity(grant.target) && !this.definitions.relationship(grant.target)) {
        throw new Error(`Graph: unknown grant target "${grant.target}"`)
      }
      if (grant.action === Action.Manage && grant.predicate) {
        throw new Error('Graph: manage grants cannot carry a row predicate')
      }
    }
  }

  #normalizeGrant(input: GrantDefinition): GraphGrant {
    const action = actionValue(input.action)
    const role = this.role(input.role)
    if (!role) throw new Error(`Graph: unknown role "${input.role}"`)
    const predicate = this.#normalizePredicate(input.target, input.predicate)
    return { action, predicate, role: role.id, target: input.target }
  }

  #normalizePredicate(
    target: string,
    input: GrantDefinition['predicate'],
  ): Filter | null {
    if (input === null || input === undefined) return null
    if (target === '*') throw new Error('Graph: a wildcard grant cannot carry a predicate')
    if (target === 'Entity') {
      const filter = typeof input === 'string'
        ? QueryNormalizer.normalize(identityDefinition(), input, name => policyField(identityDefinition(), name))
        : Predicate.normalize(identityDefinition(), input, name => policyField(identityDefinition(), name))
      if (filter) assertPolicySafe(filter)
      return filter
    }
    const entity = this.#policyEntity(target)
    if (!entity) throw new Error(`Graph: unknown grant target "${target}"`)
    const filter = typeof input === 'string'
      ? QueryNormalizer.normalize(entity, input, name => policyField(entity, name))
      : Predicate.normalize(entity, input, name => policyField(entity, name))
    if (filter) assertPolicySafe(filter)
    return filter
  }

  #policies(appRole: string): PhysicalPolicy[] {
    const role = quoteIdentifier(appRole)
    const policies: PhysicalPolicy[] = []
    const tables = ['Entity', ...this.definitions.entities.map(entity => entity.name),
      ...this.definitions.relationships.map(relationship => relationship.name)]
    for (const table of tables) {
      const relationship = this.definitions.relationship(table)
      for (const [action, command] of [
        [Action.Read, 'SELECT'],
        [Action.Create, 'INSERT'],
        [Action.Update, 'UPDATE'],
        [Action.Delete, 'DELETE'],
      ] as const) {
        const expression = table === 'Entity'
          ? this.#entityRootExpression(action)
          : relationship
            ? this.#relationshipExpression(table, action, quoteIdentifier(table))
            : this.#entityTableExpression(table, action)
        const condition = expression ?? 'FALSE'
        const using = command === 'INSERT' ? '' : ` USING (${condition})`
        const check = command === 'INSERT' || command === 'UPDATE'
          ? ` WITH CHECK (${condition})`
          : ''
        const name = `basis_${table.replaceAll(/[^A-Za-z0-9]/g, '_')}_${action}`
        policies.push({
          command,
          definition: `USING ${command === 'INSERT' ? 'TRUE' : condition} ` +
            `WITH CHECK ${command === 'INSERT' || command === 'UPDATE' ? condition : 'TRUE'}`,
          name,
          permissive: 'PERMISSIVE',
          roles: [appRole],
          sql: `CREATE POLICY ${quoteIdentifier(name)} ON ${quoteIdentifier(table)} ` +
            `FOR ${command} TO ${role}${using}${check}`,
          table,
        })
      }
    }
    return policies
  }

  #entityRootExpression(action: Action): string | null {
    const leaves = this.definitions.concreteDescendants('Entity').map(entity => entity.name)
    const conditions: string[] = []
    for (const leaf of leaves) {
      const row = quoteIdentifier('Entity')
      const alias = `__root_${conditions.length}`
      const expression = action === Action.Create
        ? this.#leafRoleExpression(leaf, action)
        : this.#leafExpression(leaf, action, alias, false)
      if (!expression) continue
      const body = action === Action.Create
        ? expression
        : `EXISTS (SELECT 1 FROM ${quoteIdentifier(leaf)} ${quoteIdentifier(alias)} ` +
          `WHERE ${quoteIdentifier(alias)}.${quoteIdentifier('id')} = ${row}.${quoteIdentifier('id')} ` +
          `AND ${expression})`
      conditions.push(`(${row}.${quoteIdentifier('entity')} = ${literal(leaf)} AND ${body})`)
    }
    return conditions.length === 0 ? null : `(${conditions.join(' OR ')})`
  }

  #entityTableExpression(table: string, action: Action): string | null {
    const leaves = this.definitions.concreteDescendants(table).map(entity => entity.name)
    const alias = quoteIdentifier(table)
    const conditions: string[] = []
    for (const leaf of leaves) {
      if (leaf === table && this.definitions.entity(table)?.abstract === false) {
        const expression = this.#leafExpression(leaf, action, alias, false)
        if (expression) conditions.push(expression)
        continue
      }
      const childAlias = `__leaf_${conditions.length}`
      const predicate = action === Action.Create
        ? this.#leafRoleExpression(leaf, action)
        : this.#leafExpression(leaf, action, childAlias, false)
      if (!predicate) continue
      if (action === Action.Create) {
        conditions.push(predicate)
        continue
      }
      conditions.push(
        `EXISTS (SELECT 1 FROM ${quoteIdentifier(leaf)} ${quoteIdentifier(childAlias)} ` +
        `WHERE ${quoteIdentifier(childAlias)}.${quoteIdentifier('id')} = ${alias}.${quoteIdentifier('id')} ` +
        `AND ${predicate})`,
      )
    }
    return conditions.length === 0 ? null : `(${conditions.join(' OR ')})`
  }

  #relationshipExpression(target: string, action: Action, alias: string): string | null {
    return this.#grantExpression(target, action, alias, false, target)
  }

  #leafExpression(leaf: string, action: Action, alias: string, roleOnly: boolean): string | null {
    return this.#grantExpression(leaf, action, alias, roleOnly, leaf)
  }

  #leafRoleExpression(leaf: string, action: Action): string | null {
    return this.#grantExpression(leaf, action, 'NULL', true, leaf)
  }

  #grantExpression(
    leaf: string,
    action: Action,
    alias: string,
    roleOnly: boolean,
    table: string,
  ): string | null {
    const targets = new Set(['*', 'Entity', ...this.#ancestry(leaf)])
    const conditions: string[] = []
    for (const grant of this.grants) {
      if (!targets.has(grant.target)) continue
      const actionMatches = grant.action === action
        || (MANAGED_ENTITIES.has(leaf) && grant.action === Action.Manage)
      if (!actionMatches) continue
      const role = roleCondition(grant.role)
      let predicate = 'TRUE'
      if (!roleOnly && grant.predicate) {
        predicate = this.#compilePredicate(grant, alias, table)
      }
      conditions.push(`(${role} AND ${predicate})`)
    }
    return conditions.length === 0 ? null : `(${conditions.join(' OR ')})`
  }

  #compilePredicate(grant: GraphGrant, alias: string, table: string): string {
    if (this.#requiresHelper(grant, table)) {
      return `${this.#helperName(grant)}(${alias}.${quoteIdentifier('id')})`
    }
    return this.#compileDirectPredicate(grant, alias, table, false)
  }

  #grantApplies(grant: GraphGrant, leaf: string): boolean {
    return new Set(['*', 'Entity', ...this.#ancestry(leaf)]).has(grant.target)
  }

  #requiresHelper(grant: GraphGrant, table: string): boolean {
    if (grant.target !== table || !grant.predicate) return grant.target !== table
    const entity = grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target)
    if (!entity) return true
    return filterFieldNames(grant.predicate).some(name => {
      const field = entity.effectiveFields.find(candidate => candidate.name === name.split('.', 1)[0])
      return !field || field.owner !== grant.target
    })
  }

  #helperName(grant: GraphGrant): string {
    const hash = createHash('sha256')
      .update(JSON.stringify({ predicate: grant.predicate, target: grant.target }))
      .digest('hex')
      .slice(0, 16)
    return `basis.policy_${hash}`
  }

  #compileDirectPredicate(
    grant: GraphGrant,
    alias: string,
    table: string,
    allowSubqueries: boolean,
  ): string {
    const entity = grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target)
    if (!entity) throw new Error(`Graph: unknown predicate target "${grant.target}"`)
    const ownerOf = (name: string): string => {
      const root = name.split('.', 1)[0] ?? name
      return entity.effectiveFields.find(field => field.name === root)?.owner ?? entity.name
    }
    const expression = (field: QueryFieldDefinition): string => {
      const owner = ownerOf(field.name)
      if (owner === table) return `${alias}.${quoteIdentifier(field.name)}`
      if (!allowSubqueries) throw new Error(`Graph: inherited policy field "${field.name}" requires a helper`)
      if (field.type === FieldType.Array || field.type === FieldType.JSON) {
        throw new Error(`Graph: inherited ${String(field.type)} policy field "${field.name}" is not supported`)
      }
      return `(SELECT ${quoteIdentifier(field.name)} FROM ${quoteIdentifier(owner)} AS __field ` +
        `WHERE __field.${quoteIdentifier('id')} = ${alias}.${quoteIdentifier('id')})`
    }
    const scope: QueryScope = {
      array: name => {
        const field = policyField(entity, name)
        if (field.type !== FieldType.Array) return undefined
        return {
          expression: expression(field),
          field,
          member: {
            ...(field.items.format ? { format: field.items.format } : {}),
            name: field.name,
            type: field.items.type,
          },
        }
      },
      definition: entity,
      expression,
      field: name => policyField(entity, name),
    }
    const where = SQL.where(this.definitions, entity.name, grant.predicate as Filter, scope)
    return `(${inline(where.sql.replace(/^WHERE\s+/u, ''), where.values)})`
  }

  #searchPath(): string {
    return this.#schema === 'public'
      ? 'public, basis, pg_temp'
      : `${this.#schema}, public, basis, pg_temp`
  }

  #identityFunctions(): PhysicalFunction[] {
    const userEntity = this.userLeaf()
    const userFields = this.definitions.entity('User')?.effectiveFields ?? []
    const email = userFields.some(field => field.name === 'email')
    const userColumns = ['"id"', ...(email ? ['"email"'] : [])].join(', ')
    const userValues = email ? 'user_id, coalesce(email_address, \'\')' : 'user_id'
    const leafInsert = userEntity === 'User'
      ? ''
      : `INSERT INTO ${quoteIdentifier(userEntity)} ("id") VALUES (user_id);`
    const functions: PhysicalFunction[] = []
    const resolveSql = `
      CREATE OR REPLACE FUNCTION basis.resolve_identity(candidate text)
      RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${this.#searchPath()} AS $$
        SELECT u."id"
        FROM "User" u
        WHERE u."id" = candidate
          AND EXISTS (
            SELECT 1
            FROM "ExternalIdentity" e
            WHERE e."user.id" = u."id" AND e."revoked" = false
          )
      $$;
    `
    functions.push({
      body: /\$\$([\s\S]*?)\$\$/u.exec(resolveSql)?.[1]?.trim() ?? '',
      lifecycle: false,
      name: 'basis.resolve_identity',
      required: ['basis.resolve_identity'],
      searchPath: this.#searchPath(),
      securityDefiner: true,
      signature: 'candidate text',
      sql: resolveSql,
    })
    const enrollSql = `
      CREATE OR REPLACE FUNCTION basis.enroll_identity(
        provider_name text,
        provider_subject text,
        display_name text,
        email_address text
      )
      RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${this.#searchPath()} AS $$
      DECLARE
        existing_revoked boolean;
        existing_user text;
        user_id text;
        identity_id text;
        user_name text;
      BEGIN
        IF provider_name IS NULL OR provider_name = ''
          OR provider_subject IS NULL OR provider_subject = '' THEN
          RETURN NULL;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(provider_name || ':' || provider_subject, 0));
        SELECT e."revoked", e."user.id" INTO existing_revoked, existing_user
        FROM "ExternalIdentity" e
        WHERE e."provider" = provider_name AND e."subject" = provider_subject
        FOR UPDATE;
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
        INSERT INTO "Entity" ("id", "name", "entity") VALUES (user_id, user_name, ${literal(userEntity)});
        INSERT INTO "User" (${userColumns}) VALUES (${userValues});
        ${leafInsert}
        identity_id := gen_random_uuid()::text;
        INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (identity_id, provider_name || ':' || provider_subject, 'ExternalIdentity');
        INSERT INTO "ExternalIdentity" ("id", "provider", "subject", "revoked", "user.id")
          VALUES (identity_id, provider_name, provider_subject, false, user_id);
        RETURN user_id;
      END $$;
    `
    functions.push({
      body: /\$\$([\s\S]*?)\$\$/u.exec(enrollSql)?.[1]?.trim() ?? '',
      lifecycle: false,
      name: 'basis.enroll_identity',
      required: ['basis.enroll_identity'],
      searchPath: this.#searchPath(),
      securityDefiner: true,
      signature: 'provider_name text, provider_subject text, display_name text, email_address text',
      sql: enrollSql,
    })
    return functions
  }

  /**
   * Resolve the concrete canonical User leaf table.
   * @returns The User table or its first concrete descendant.
   */
  userLeaf(): string {
    return this.definitions.concreteDescendants('User')[0]?.name ?? 'User'
  }

  #policyFunctions(): PhysicalFunction[] {
    const functions: PhysicalFunction[] = []
    const seen = new Set<string>()
    for (const grant of this.grants) {
      if (!grant.predicate) continue
      const needed = [...this.definitions.concreteDescendants('Entity').map(entity => entity.name),
        ...this.definitions.relationships.map(relationship => relationship.name)]
        .some(leaf => this.#grantApplies(grant, leaf) && this.#requiresHelper(grant, leaf))
      if (!needed) continue
      const name = this.#helperName(grant)
      if (seen.has(name)) continue
      seen.add(name)
      const predicate = this.#compileDirectPredicate(grant, '__row', grant.target, true)
      const sql = `
        CREATE OR REPLACE FUNCTION ${name}(root_id text)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${this.#searchPath()} AS $$
          SELECT EXISTS (
            SELECT 1
            FROM ${quoteIdentifier(grant.target)} AS "__row"
            WHERE "__row".${quoteIdentifier('id')} = root_id
              AND ${predicate}
          )
        $$;
      `
      functions.push({
        body: /\$\$([\s\S]*?)\$\$/u.exec(sql)?.[1]?.trim() ?? '',
        lifecycle: false,
        name,
        required: [name],
        searchPath: this.#searchPath(),
        securityDefiner: true,
        signature: 'root_id text',
        sql,
      })
    }
    return functions
  }

  #manageExpression(target: string): string | null {
    const conditions = this.grants
      .filter(grant => grant.action === Action.Manage
        && (grant.target === '*' || grant.target === target))
      .map(grant => roleCondition(grant.role))
    return conditions.length === 0 ? null : `(${conditions.join(' OR ')})`
  }

  #ancestry(name: string): readonly string[] {
    if (this.definitions.entity(name)) return this.definitions.ancestry(name)
    if (this.definitions.relationship(name)) return [name, 'Entity']
    return []
  }

  #policyEntity(name: string): EntityDefinition | undefined {
    if (name === 'Entity') return identityDefinition()
    const entity = this.definitions.entity(name)
    if (entity) {
      return {
        ...entity,
        effectiveFields: entity.effectiveFields,
        fields: entity.effectiveFields,
      }
    }
    const relationship = this.definitions.relationship(name)
    if (!relationship) return undefined
    const fields = [
      ...relationship.between.map(endpoint => ({
        column: `${endpoint.field}.id`,
        name: endpoint.field,
        owner: name,
        target: endpoint.target,
        type: FieldType.Entity as const,
      })),
      ...relationship.fields.map(field => ({ ...field, owner: name })),
    ]
    return {
      abstract: false,
      collections: [],
      effectiveFields: fields,
      fields: fields as EntityDefinition['fields'],
      inverseFields: [],
      name,
      parent: 'Entity',
      singularNavigations: [],
    }
  }

  #indexes(): PhysicalIndex[] {
    const indexes: PhysicalIndex[] = []
    const external = this.definitions.entity('ExternalIdentity')
    if (external) {
      indexes.push({
        columns: ['provider', 'subject'],
        name: 'ExternalIdentity_provider_subject_key',
        sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIdentity_provider_subject_key" ' +
          'ON "ExternalIdentity" ("provider", "subject")',
        table: 'ExternalIdentity',
        unique: true,
      })
    }
    if (this.definitions.relationship('UserRole')) {
      indexes.push(
        {
          columns: ['user.id'],
          name: 'UserRole_user_idx',
          sql: 'CREATE INDEX IF NOT EXISTS "UserRole_user_idx" ON "UserRole" ("user.id")',
          table: 'UserRole',
        },
        {
          columns: ['role.id'],
          name: 'UserRole_role_idx',
          sql: 'CREATE INDEX IF NOT EXISTS "UserRole_role_idx" ON "UserRole" ("role.id")',
          table: 'UserRole',
        },
      )
    }
    return indexes
  }

  #grants(appRole: string): PhysicalGrant[] {
    const role = quoteIdentifier(appRole)
    const grants: PhysicalGrant[] = []
    for (const table of ['Entity', ...this.definitions.entities.map(entity => entity.name),
      ...this.definitions.relationships.map(relationship => relationship.name)]) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const grantName = `grant:${appRole}:table:${table}:${privilege}`
        grants.push({
          grantName,
          grantee: appRole,
          kind: 'grant',
          name: grantName,
          object: 'table',
          privilege,
          sql: `GRANT ${privilege} ON ${quoteIdentifier(table)} TO ${role}`,
          table,
        })
      }
    }
    for (const schema of ['public', 'basis']) {
      const grantName = `grant:${appRole}:schema:${schema}:USAGE`
      grants.push({
        grantName,
        grantee: appRole,
        kind: 'grant',
        name: grantName,
        object: 'schema',
        privilege: 'USAGE',
        sql: `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
        table: schema,
      })
    }
    const functionGrant = `grant:${appRole}:function:basis.has_role:EXECUTE`
    grants.push({
      function: 'basis.has_role',
      grantName: functionGrant,
      grantee: appRole,
      kind: 'grant',
      name: functionGrant,
      object: 'function',
      privilege: 'EXECUTE',
      sql: `GRANT EXECUTE ON FUNCTION basis.has_role(text) TO ${role}`,
    })
    const publicFunctionGrant = functionGrant.replace(`grant:${appRole}:`, 'grant:PUBLIC:')
    grants.push({
      function: 'basis.has_role',
      grantName: publicFunctionGrant,
      grantee: 'PUBLIC',
      kind: 'revoke',
      name: `revoke:${publicFunctionGrant}`,
      object: 'function',
      privilege: 'EXECUTE',
      sql: 'REVOKE ALL ON FUNCTION basis.has_role(text) FROM PUBLIC',
    })
    for (const fn of this.#policyFunctions()) {
      const helperGrant = `grant:${appRole}:function:${fn.name}:EXECUTE`
      grants.push({
        function: fn.name,
        grantName: helperGrant,
        grantee: appRole,
        kind: 'grant',
        name: helperGrant,
        object: 'function',
        privilege: 'EXECUTE',
        sql: `GRANT EXECUTE ON FUNCTION ${fn.name}(${fn.signature ?? 'text'}) TO ${role}`,
      })
      const publicHelperGrant = helperGrant.replace(`grant:${appRole}:`, 'grant:PUBLIC:')
      grants.push({
        function: fn.name,
        grantName: publicHelperGrant,
        grantee: 'PUBLIC',
        kind: 'revoke',
        name: `revoke:${publicHelperGrant}`,
        object: 'function',
        privilege: 'EXECUTE',
        sql: `REVOKE ALL ON FUNCTION ${fn.name}(${fn.signature ?? 'text'}) FROM PUBLIC`,
      })
    }
    for (const fn of this.#identityFunctions()) {
      const identityGrant = `grant:${appRole}:function:${fn.name}:EXECUTE`
      grants.push({
        function: fn.name,
        grantName: identityGrant,
        grantee: appRole,
        kind: 'grant',
        name: identityGrant,
        object: 'function',
        privilege: 'EXECUTE',
        sql: `GRANT EXECUTE ON FUNCTION ${fn.name}(${fn.signature ?? 'text'}) TO ${role}`,
      })
      const publicIdentityGrant = identityGrant.replace(`grant:${appRole}:`, 'grant:PUBLIC:')
      grants.push({
        function: fn.name,
        grantName: publicIdentityGrant,
        grantee: 'PUBLIC',
        kind: 'revoke',
        name: `revoke:${publicIdentityGrant}`,
        object: 'function',
        privilege: 'EXECUTE',
        sql: `REVOKE ALL ON FUNCTION ${fn.name}(${fn.signature ?? 'text'}) FROM PUBLIC`,
      })
    }
    grants.push({
      grantName: `grant:${appRole}:schema:public:CREATE`,
      grantee: appRole,
      kind: 'revoke',
      name: `revoke:grant:${appRole}:schema:public:CREATE`,
      object: 'schema',
      privilege: 'CREATE',
      sql: `REVOKE CREATE ON SCHEMA public FROM ${role}`,
      table: 'public',
    })
    return grants
  }

  #hasRoleFunction(): string {
    return `
      CREATE OR REPLACE FUNCTION basis.has_role(role_id text)
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${this.#searchPath()} AS $$
        SELECT EXISTS (
          SELECT 1
          FROM "UserRole" ur
          WHERE ur."role.id" = role_id
            AND ur."user.id" = nullif(current_setting('actor.id', true), '')
        )
      $$;
    `
  }
}

/**
 * Normalize graph authoring input into one authored document.
 * @param options - Graph options.
 * @returns The application authored document.
 */
/** Authored document with any unknown keys retained for canonical validation. */
type GraphAuthoringDocument = AuthoredDocument & Readonly<Record<string, unknown>>

/**
 * Normalize one parsed or typed authored document while preserving every key.
 * @param document - Authored document candidate.
 * @param relationships - Optional explicit relationship override.
 * @returns The authored document with normalized entities and relationships.
 */
function normalizeDocument(
  document: GraphAuthoringDocument,
  relationships: GraphOptions['relationships'],
): GraphAuthoringDocument {
  if (document.entities !== undefined && !Array.isArray(document.entities)) {
    throw new Error('Graph: entities must be an authored document or entity array')
  }
  return {
    ...document,
    entities: document.entities ?? [],
    ...(relationships === undefined ? {} : { relationships }),
  }
}

/**
 * Normalize graph authoring input into one authored document.
 * @param options - Graph options.
 * @returns The application authored document.
 */
function normalizeGraphInput(options: GraphOptions): GraphAuthoringDocument {
  const input = options.entities
  if (input instanceof EntityDefinitions) {
    throw new Error('Graph: pass authored entities instead of EntityDefinitions')
  }
  if (typeof input === 'string') {
    const parsed: unknown = JSON.parse(input)
    if (isAuthoredEntityArray(parsed)) {
      return { entities: parsed, relationships: options.relationships }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Graph: entities must be an authored document or entity array')
    }
    return normalizeDocument(parsed as GraphAuthoringDocument, options.relationships)
  }
  if (isAuthoredEntityArray(input)) {
    return { entities: input, relationships: options.relationships }
  }
  if (input && typeof input === 'object') {
    return normalizeDocument(input as GraphAuthoringDocument, options.relationships)
  }
  return { entities: [], relationships: options.relationships }
}

/**
 * Whether a value is an authored entity array.
 * @param value - Candidate value.
 * @returns Whether the value is an array of entity declarations.
 */
function isAuthoredEntityArray(value: unknown): value is readonly AuthoredEntity[] {
  return Array.isArray(value)
}

/**
 * Read one raw entity name.
 * @param entity - Raw entity declaration.
 * @returns Its name, or an empty string.
 */
function entityName(entity: unknown): string {
  if (!entity || typeof entity !== 'object') return ''
  const name = (entity as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

/**
 * Normalize the authored role forms.
 * @param source - Role source.
 * @returns Roles including built-ins, without duplicates.
 */
function normalizeRoles(source?: RoleSource): readonly GraphRole[] {
  const roles = new Map<string, GraphRole>([
    [PUBLIC_ROLE.id, PUBLIC_ROLE],
    [ADMIN_ROLE.id, ADMIN_ROLE],
  ])
  const entries: readonly (readonly [string, RoleDetails])[] = source instanceof Map
    ? [...source.entries()]
    : Array.isArray(source)
      ? source.map(role => [role.id, role] as const)
      : Object.entries(source ?? {})
  for (const [id, details] of entries) {
    if (!id || id === PUBLIC_ROLE_ID) continue
    const canonical = roleIdentity(id)
    roles.set(canonical, {
      ...(details.description === undefined ? {} : { description: details.description }),
      id: canonical,
      name: details.name || id,
    })
  }
  return [...roles.values()]
}

/**
 * Normalize one authored role identity.
 * @param id - Canonical UUID, built-in alias, or stable authoring alias.
 * @returns A canonical UUID or the public sentinel.
 */
function roleIdentity(id: string): string {
  if (id === PUBLIC_ROLE_ID) return PUBLIC_ROLE_ID
  if (id === 'admin') return ADMIN_ROLE_ID
  if (isCanonicalUUID(id)) return id.toLowerCase()
  const digest = createHash('sha256').update(id).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-` +
    `${digest.slice(16, 20)}-${digest.slice(20, 32)}`
}

/**
 * Resolve one policy-safe field.
 * @param entity - Policy entity view.
 * @param name - Logical or dotted reference field name.
 * @returns Scalar, array, or JSON field metadata.
 */
function policyField(entity: EntityDefinition, name: string): QueryFieldDefinition {
  const [root, suffix] = name.split('.', 2)
  const field = entity.effectiveFields.find(candidate => candidate.name === root)
  if (!field) throw new Error(`Graph: unknown field "${entity.name}.${name}"`)
  if (field.type === FieldType.Entity) {
    if (suffix !== undefined && suffix !== 'id') {
      throw new Error(`Graph: reference field "${entity.name}.${name}" is not policy-safe`)
    }
    return { name: field.column, type: FieldType.ID }
  }
  if (suffix !== undefined) throw new Error(`Graph: unknown field "${entity.name}.${name}"`)
  return field
}

/**
 * Reject predicate constructs that are not safe in a static policy.
 * @param filter - Canonical predicate.
 */
function assertPolicySafe(filter: Filter): void {
  if ('filters' in filter) {
    if ('field' in filter) {
      throw new Error('Graph: collection policy predicates are not supported')
    }
    for (const child of filter.filters) assertPolicySafe(child)
    return
  }
  if (!('field' in filter) || !('operator' in filter)) {
    throw new Error('Graph: policy predicates must be field comparisons')
  }
  if (filter.operator === Operator.Comparison.Overlaps
    || filter.operator === Operator.Comparison.SequenceEqual) {
    throw new Error(`Graph: operator "${filter.operator}" is not policy-safe`)
  }
}

/**
 * Compile one role-membership condition.
 * @param role - Canonical role id.
 * @returns SQL boolean expression.
 */
function roleCondition(role: string): string {
  if (role === PUBLIC_ROLE_ID) return 'TRUE'
  return `basis.has_role(${literal(role)})`
}

/**
 * Quote a PostgreSQL identifier.
 * @param identifier - Identifier text.
 * @returns The quoted identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/**
 * Quote one SQL literal.
 * @param value - Literal value.
 * @returns SQL literal text.
 */
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`
  if (Array.isArray(value)) {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'`
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
  }
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * Inline bound parameters into a policy expression.
 * @param sql - SQL with positional placeholders.
 * @param values - Bound values.
 * @returns SQL with literals.
 */
function inline(sql: string, values: readonly unknown[]): string {
  return sql.replace(/\$(\d+)/gu, (_match, index: string) => literal(values[Number(index) - 1]))
}

/**
 * Collect root field names used by one canonical predicate.
 * @param filter - Canonical predicate.
 * @returns Root field names in traversal order.
 */
function filterFieldNames(filter: Filter): string[] {
  if ('filters' in filter) {
    return filter.filters.flatMap(child => filterFieldNames(child))
  }
  return 'field' in filter ? [filter.field] : []
}

/**
 * Normalize one action literal.
 * @param action - Action input.
 * @returns The validated action.
 */
function actionValue(action: Action | `${Action}`): Action {
  if (!Object.values(Action).includes(action as Action)) {
    throw new Error(`Graph: unknown action "${action}"`)
  }
  return action as Action
}
