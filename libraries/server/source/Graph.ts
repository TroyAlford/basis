import { createHash } from 'node:crypto'
import type { EntityDefinition, QueryFieldDefinition, RelationshipDefinition } from './EntityDefinitions'
import { EntityDefinitions, FieldType, identityDefinition, isCanonicalUUID, relationshipEntityDefinition } from './EntityDefinitions'
import type { AuthoredDocument, AuthoredEntity, AuthoredRelationship, AuthoredSecurity } from './GraphAuthoring'
import { compileEntityPredicate, normalizeEntityFilter } from './PolymorphicQuery'
import type { Filter } from './Predicate'
import { isFieldOperand } from './Predicate'
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

/** Explicit public-access sentinel for entity and relationship security. */
export enum Security {
  /** Allow the action to every request. */
  Public = 'public',
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
  /** Named capabilities assigned to this role. */
  readonly grants?: readonly string[],
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

/** One typed named capability declaration. */
export interface GrantCapability {
  /** Optional human-readable capability description. */
  readonly description?: string,
  /** Capability name used by security rules and role assignments. */
  readonly name: string,
}

/** Named capability declarations. */
export type GrantSource = Readonly<Record<string, { readonly description?: string }>>

/** Raw row-predicate input accepted by Graph security normalization. */
type PredicateInput = Filter | Readonly<Record<string, unknown>> | string | null

/** One normalized rule alternative inside an action security declaration. */
export interface SecurityRuleDefinition {
  /** Named capability required by this alternative. */
  readonly grant?: string,
  /** Graph role required by this alternative. */
  readonly role?: string,
  /** Canonical row predicate required by this alternative, or null. */
  readonly where: Filter | null,
}

/** One normalized action security declaration. */
export interface SecurityDefinition {
  /** Closed action. */
  readonly action: Action,
  /** Entity or relationship owning the declaration. */
  readonly owner: string,
  /** Alternative rules combined with OR. */
  readonly rules: readonly SecurityRuleDefinition[],
}

/** Canonical graph authoring options. */
export interface GraphOptions {
  /** Application ontology as JSON text, a document, or an entity array. */
  readonly entities?: AuthoredDocument | readonly AuthoredEntity[] | string,
  /** Named reusable Graph enum declarations. */
  readonly enums?: Readonly<Record<string, Readonly<Record<string, string>>>>,
  /** Graph-defined permission declarations. */
  readonly grants?: GrantSource,
  /** Application relationships when `entities` is an entity array. */
  readonly relationships?: readonly AuthoredRelationship[],
  /** Role authoring forms and stable identifiers. */
  readonly roles?: RoleSource,
  /** Application schema used by compiled security functions; defaults to public. */
  readonly schema?: string,
  /** Action security keyed by system or overridden owner name. */
  readonly security?: Readonly<Record<string, AuthoredSecurity>>,
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
const ADMIN_ROLE: GraphRole = { grants: [], id: ADMIN_ROLE_ID, name: 'Administrator' }
/** The built-in public principal. */
const PUBLIC_ROLE: GraphRole = { grants: [], id: PUBLIC_ROLE_ID, name: 'Public' }
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
  /** Named reusable capabilities declared by the graph. */
  readonly capabilities: readonly GrantCapability[]
  /** Canonical graph-defined permissions in one normalized list. */
  readonly grants: readonly GraphGrant[]
  /** Canonical roles, including the built-in public principal. */
  readonly roles: readonly GraphRole[]
  /** Canonical action security declarations. */
  readonly security: readonly SecurityDefinition[]
  readonly #capabilities: ReadonlyMap<string, GrantCapability>
  readonly #options: GraphOptions
  readonly #rolesById: ReadonlyMap<string, GraphRole>
  readonly #rolesByName: ReadonlyMap<string, GraphRole>
  readonly #schema: string

  /**
   * Build and validate the graph.
   * @param options - Application ontology, roles, and grants.
   */
  constructor(options: GraphOptions = {}) {
    this.#options = options
    const application = normalizeGraphInput(options)
    const securitySources = new Map<string, unknown>()
    const entities = (application.entities ?? []).map(entity => takeSecurity(entity, securitySources))
    const relationships = (application.relationships ?? [])
      .map(relationship => takeSecurity(relationship, securitySources))
    for (const [owner, security] of Object.entries(options.security ?? {})) {
      if (securitySources.has(owner)) {
        throw new Error(`Graph: security for "${owner}" is declared more than once`)
      }
      securitySources.set(owner, security)
    }
    for (const entity of entities) {
      const name = entityName(entity)
      if (RESERVED_NAMES.has(name)) {
        throw new Error(`Entity "${name}" is reserved by Basis authorization`)
      }
    }
    const hasUser = entities.some(entity => entityName(entity) === 'User')
    const systemEntities = SYSTEM_DOCUMENT.entities ?? []
    const allEntities = [
      ...systemEntities.filter(entity => hasUser === false || entityName(entity) !== 'User'),
      ...entities,
    ]
    this.definitions = EntityDefinitions.fromDocument({
      ...application,
      entities: allEntities,
      relationships: [...(SYSTEM_DOCUMENT.relationships ?? []), ...relationships],
    })
    this.#capabilities = capabilitiesFrom(options.grants)
    this.capabilities = [...this.#capabilities.values()]
    this.roles = normalizeRoles(options.roles)
    this.#schema = options.schema ?? 'public'
    this.#rolesById = new Map(this.roles.map(role => [role.id, role]))
    this.#rolesByName = new Map(this.roles.map(role => [role.name, role]))
    this.#assertRoleCapabilities()
    this.security = this.#normalizeSecurity(securitySources)
    this.#assertSecurityInheritance()
    this.grants = this.#expandSecurity()
    this.#assertPolicyTargets()
  }

  /**
   * Materialize the authored graph options for a deterministic checked-in snapshot.
   * @returns JSON-compatible graph authoring options.
   */
  toJSON(): GraphOptions {
    const application = normalizeGraphInput(this.#options)
    return {
      ...(application.entities === undefined ? {} : { entities: application.entities }),
      ...(application.enums === undefined ? {} : { enums: application.enums }),
      ...(application.relationships === undefined ? {} : { relationships: application.relationships }),
      ...(this.#options.grants === undefined ? {} : { grants: this.#options.grants }),
      ...(this.#options.roles === undefined ? {} : { roles: this.#options.roles }),
      ...(this.#options.schema === undefined ? {} : { schema: this.#options.schema }),
      ...(this.#options.security === undefined ? {} : { security: this.#options.security }),
    }
  }

  /**
   * Every normalized declarative constraint in the graph.
   * @returns Canonical uniqueness and validation constraints.
   */
  get constraints() {
    return this.definitions.constraints
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
    const base = this.definitions.physicalSchema()
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
    const readable = this.#rowExpression(target, Action.Read, row)
    const creatable = this.#rowExpression(target, Action.Create, row)
    if (!readable || !creatable) return null
    return `((${readable}) AND (${creatable}))`
  }

  /**
   * Compile action rules against proposed row values for create checks.
   * @param target - Entity or relationship being created.
   * @param action - Action being evaluated.
   * @param row - Proposed new-row values.
   * @returns SQL expression, or null when no rule applies.
   */
  #rowExpression(
    target: string,
    action: Action,
    row: Record<string, unknown>,
  ): string | null {
    const targets = new Set(this.#ancestry(target))
    const conditions: string[] = []
    for (const grant of this.grants) {
      if (!targets.has(grant.target)) continue
      const actionMatches = grant.action === action
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
        const field = entity.effectiveFields.find(candidate => candidate.name === name)
        if (!field || field.type !== FieldType.Array) return undefined
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
      expression: field => (field.name === '$me'
        ? "nullif(current_setting('actor.id', true), '')"
        : literal(valueFor(field.name.split('.', 1)[0] ?? field.name))),
      field: name => {
        if (name === '$me') return { name, type: FieldType.ID }
        if (name.endsWith('.id')) {
          const root = name.slice(0, -3)
          const field = entity.effectiveFields.find(candidate => (
            candidate.name === root && candidate.type === FieldType.Entity
          ))
          if (!field) throw new Error(`Graph: unknown reference path "${entity.name}.${name}"`)
          return { name, type: FieldType.ID }
        }
        if (name.includes('.')) {
          throw new Error(`Graph: create security cannot derive field path "${entity.name}.${name}"`)
        }
        const field = entity.effectiveFields.find(candidate => candidate.name === name)
        if (!field) throw new Error(`Graph: unknown field "${entity.name}.${name}"`)
        return field.type === FieldType.Entity ? { name: field.column, type: FieldType.ID } : field
      },
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

  /**
   * Validate that every role references a declared capability.
   */
  #assertRoleCapabilities(): void {
    for (const role of this.roles) {
      for (const name of role.grants ?? []) {
        if (!this.#capabilities.has(name)) {
          throw new Error(`Graph: role "${role.name}" references unknown capability "${name}"`)
        }
      }
    }
  }

  /**
   * Normalize authored entity and relationship security declarations.
   * @param sources - Raw security declarations keyed by owner name.
   * @returns Canonical security declarations.
   */
  #normalizeSecurity(sources: ReadonlyMap<string, unknown>): readonly SecurityDefinition[] {
    const declarations: SecurityDefinition[] = []
    for (const [owner, raw] of sources) {
      if (!this.definitions.entity(owner) && !this.definitions.relationship(owner)) {
        throw new Error(`Graph: security owner "${owner}" is not a declared entity or relationship`)
      }
      if (!isRecordLike(raw)) {
        throw new Error(`Graph: security for "${owner}" must be an object`)
      }
      for (const [actionName, value] of Object.entries(raw)) {
        const action = actionValue(actionName)
        const rules = this.#normalizeSecurityRules(owner, action, value)
        declarations.push({ action, owner, rules })
      }
    }
    return declarations
  }

  /**
   * Normalize one action's alternatives or explicit public sentinel.
   * @param owner - Entity or relationship owner.
   * @param action - Action being declared.
   * @param value - Authored action security.
   * @returns Canonical alternative rules.
   */
  #normalizeSecurityRules(
    owner: string,
    action: Action,
    value: unknown,
  ): readonly SecurityRuleDefinition[] {
    if (value === Security.Public) return [{ where: null }]
    const candidates = Array.isArray(value) ? value : [value]
    return candidates.map(candidate => {
      if (candidate === Security.Public) return { where: null }
      if (!isRecordLike(candidate)) {
        throw new Error(`Graph: security rule for "${owner}" must be an object`)
      }
      const keys = Object.keys(candidate)
      if (keys.some(key => key !== 'grant' && key !== 'role' && key !== 'where')) {
        throw new Error(`Graph: security rule for "${owner}" has an unknown property`)
      }
      const hasGrant = candidate.grant !== undefined
      const hasRole = candidate.role !== undefined
      if (hasGrant && hasRole) {
        throw new Error(
          `Graph: security rule for "${owner}" cannot declare both grant and role`,
        )
      }
      const where = candidate.where === undefined || candidate.where === null
        ? null
        : this.#normalizePredicate(owner, candidate.where as PredicateInput)
      if (!hasGrant && !hasRole && where === null) {
        throw new Error(
          `Graph: security rule for "${owner}" must declare grant, role, or a non-empty where`,
        )
      }
      if (action === Action.Create && where && filterContainsCollection(where)) {
        throw new Error(`Graph: create security for "${owner}" cannot use collection predicates`)
      }
      if (action === Action.Manage && where) {
        throw new Error(`Graph: manage security for "${owner}" cannot use a row predicate`)
      }
      if (hasGrant) {
        if (typeof candidate.grant !== 'string' || !this.#capabilities.has(candidate.grant)) {
          throw new Error(`Graph: unknown capability "${String(candidate.grant)}" for "${owner}"`)
        }
        return { grant: candidate.grant, where }
      }
      if (hasRole) {
        if (typeof candidate.role !== 'string') {
          throw new Error(`Graph: security role for "${owner}" must be a string`)
        }
        const role = this.role(candidate.role)
        if (!role) throw new Error(`Graph: unknown role "${candidate.role}"`)
        if (role.id === PUBLIC_ROLE_ID) {
          throw new Error(`Graph: security for "${owner}" must use Security.Public for public access`)
        }
        return { role: role.id, where }
      }
      return { where: where as Filter }
    })
  }

  /**
   * Expand normalized security declarations into the one compiler grant list.
   * @returns Expanded grants in declaration order.
   */
  #expandSecurity(): GraphGrant[] {
    const grants: GraphGrant[] = []
    for (const declaration of this.security) {
      for (const rule of declaration.rules) {
        const roles = rule.grant === undefined
          ? rule.role === undefined
            ? [PUBLIC_ROLE.id]
            : [rule.role]
          : this.roles.filter(role => (role.grants ?? []).includes(rule.grant as string)).map(role => role.id)
        for (const role of roles) {
          grants.push({
            action: declaration.action,
            predicate: rule.where,
            role,
            target: declaration.owner,
          })
        }
      }
    }
    return grants
  }

  /**
   * Reject authoring security on both an entity and any of its ancestors.
   */
  #assertSecurityInheritance(): void {
    const owners = new Set(this.security.map(declaration => declaration.owner))
    for (const owner of owners) {
      if (!this.definitions.entity(owner)) continue
      for (const ancestor of this.definitions.ancestry(owner)) {
        if (ancestor === 'Entity' || ancestor === owner) continue
        if (owners.has(ancestor)) {
          throw new Error(`Graph: security is declared on both "${ancestor}" and "${owner}"`)
        }
      }
    }
  }

  #assertPolicyTargets(): void {
    for (const grant of this.grants) {
      if (!this.definitions.entity(grant.target) && !this.definitions.relationship(grant.target)) {
        throw new Error(`Graph: unknown security target "${grant.target}"`)
      }
      if (grant.action === Action.Manage && grant.predicate) {
        throw new Error('Graph: manage security cannot carry a row predicate')
      }
      if (grant.action === Action.Create && grant.predicate && filterContainsCollection(grant.predicate)) {
        throw new Error('Graph: create security cannot use collection predicates')
      }
    }
  }

  #normalizePredicate(
    target: string,
    input: PredicateInput,
  ): Filter | null {
    if (input === null || input === undefined) return null
    const entity = this.#policyEntity(target)
    if (!entity) throw new Error(`Graph: unknown security target "${target}"`)
    return normalizeEntityFilter(this.definitions, entity, input)
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
    return this.#grantExpression(target, action, alias, false)
  }

  #leafExpression(leaf: string, action: Action, alias: string, roleOnly: boolean): string | null {
    return this.#grantExpression(leaf, action, alias, roleOnly)
  }

  #leafRoleExpression(leaf: string, action: Action): string | null {
    return this.#grantExpression(leaf, action, 'NULL', true)
  }

  #grantExpression(
    leaf: string,
    action: Action,
    alias: string,
    roleOnly: boolean,
  ): string | null {
    const rowMode = action === Action.Create || action === Action.Update
    const conditions = this.#actionConditions(leaf, action, alias, roleOnly, rowMode)
    if (conditions.length === 0) return null
    if (action === Action.Read || roleOnly) return `(${conditions.join(' OR ')})`
    if (action !== Action.Create && action !== Action.Update && action !== Action.Delete) {
      return `(${conditions.join(' OR ')})`
    }
    const readable = this.#actionConditions(leaf, Action.Read, alias, false, rowMode)
    if (readable.length === 0) return null
    return `((${readable.join(' OR ')}) AND (${conditions.join(' OR ')}))`
  }

  /**
   * Compile the direct action rules before the READ prerequisite is applied.
   * @param leaf - Concrete entity or relationship table.
   * @param action - Action being evaluated.
   * @param alias - Row alias.
   * @param roleOnly - Whether predicates are omitted.
   * @param rowMode - Whether predicates evaluate the resulting row instead of an existing identity.
   * @returns Matching rule expressions.
   */
  #actionConditions(
    leaf: string,
    action: Action,
    alias: string,
    roleOnly: boolean,
    rowMode = false,
  ): string[] {
    const targets = new Set([...this.#ancestry(leaf)])
    const conditions: string[] = []
    for (const grant of this.grants) {
      if (!targets.has(grant.target)) continue
      const actionMatches = grant.action === action
        || (MANAGED_ENTITIES.has(leaf) && grant.action === Action.Manage)
      if (!actionMatches) continue
      const role = roleCondition(grant.role)
      let predicate = 'TRUE'
      if (!roleOnly && grant.predicate) {
        predicate = rowMode && rowPredicateSupported(grant.predicate)
          ? this.#compileRowPredicate(grant, alias)
          : this.#compilePredicate(grant, alias)
      }
      conditions.push(`(${role} AND ${predicate})`)
    }
    return conditions
  }

  #compilePredicate(grant: GraphGrant, alias: string): string {
    return `${this.#helperName(grant)}(${this.#helperArguments(grant, alias)})`
  }

  /**
   * Compile a predicate against the proposed or resulting row alias.
   * @param grant - Predicate grant.
   * @param alias - Physical row alias.
   * @returns SQL boolean expression.
   */
  #compileRowPredicate(grant: GraphGrant, alias: string): string {
    const entity = grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target)
    if (!entity) throw new Error(`Graph: unknown predicate target "${grant.target}"`)
    const scope = this.#rowScope(entity, alias)
    const where = SQL.where(this.definitions, entity.name, grant.predicate as Filter, scope)
    return `(${inline(where.sql.replace(/^WHERE\s+/u, ''), where.values)})`
  }

  /**
   * Build a predicate scope whose field expressions read the proposed row.
   * @param entity - Entity-shaped predicate owner.
   * @param alias - Physical row alias.
   * @returns Query scope over the row columns.
   */
  #rowScope(entity: EntityDefinition, alias: string): QueryScope {
    const fields = entity.effectiveFields
    const rootField = (name: string) => {
      const [root] = name.split('.', 1)
      const field = fields.find(candidate => candidate.name === root)
      if (!field) throw new Error(`Graph: unknown field "${entity.name}.${name}"`)
      return field
    }
    const resolve = (name: string): QueryFieldDefinition => {
      if (name === '$me') return { name, type: FieldType.ID }
      const rest = name.split('.').slice(1)
      const field = rootField(name)
      if (rest.length === 0) {
        return field.type === FieldType.Entity
          ? { name, type: FieldType.ID }
          : field
      }
      if (field.type !== FieldType.Entity) {
        throw new Error(`Graph: query path "${entity.name}.${name}" traverses a scalar field`)
      }
      if (rest.length === 1 && rest[0] === 'id') return { name, type: FieldType.ID }
      const target = field.target === 'Entity' ? identityDefinition() : this.definitions.entity(field.target)
      if (!target) throw new Error(`Graph: unknown target entity "${field.target}"`)
      const nested = target.effectiveFields.find(candidate => candidate.name === rest.join('.'))
      if (!nested || nested.type === FieldType.Entity) {
        throw new Error(`Graph: create or update policy path "${entity.name}.${name}" is not supported`)
      }
      return { ...nested, name }
    }
    const expression = (field: QueryFieldDefinition): string => {
      if (field.name === '$me') return "nullif(current_setting('actor.id', true), '')"
      const rest = field.name.split('.').slice(1)
      const physical = rootField(field.name)
      if (rest.length === 0) {
        return `${alias}.${quoteIdentifier(physical.type === FieldType.Entity ? physical.column : physical.name)}`
      }
      if (physical.type !== FieldType.Entity || rest.length !== 1) {
        throw new Error(`Graph: create or update policy path "${field.name}" is not supported`)
      }
      const target = physical.target === 'Entity' ? identityDefinition() : this.definitions.entity(physical.target)
      if (!target) throw new Error(`Graph: unknown target entity "${physical.target}"`)
      const nested = target.effectiveFields.find(candidate => candidate.name === rest[0])
      if (!nested || nested.type === FieldType.Entity) {
        throw new Error(`Graph: create or update policy path "${field.name}" is not supported`)
      }
      return `(SELECT "__policy_ref".${quoteIdentifier(nested.name)} FROM ${quoteIdentifier(target.name)} ` +
        `AS "__policy_ref" WHERE "__policy_ref".${quoteIdentifier('id')} = ` +
        `${alias}.${quoteIdentifier(physical.column)})`
    }
    return {
      array: name => {
        if (name.includes('.')) return undefined
        const field = fields.find(candidate => candidate.name === name)
        if (!field || field.type !== FieldType.Array) return undefined
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
      field: resolve,
    }
  }

  /**
   * Build helper arguments for one entity or relationship grant target.
   * @param grant - Predicate grant.
   * @param alias - Physical row alias.
   * @returns Comma-separated argument SQL.
   */
  #helperArguments(grant: GraphGrant, alias: string): string {
    const relationship = this.definitions.relationship(grant.target)
    if (!relationship) return `${alias}.${quoteIdentifier('id')}`
    return relationship.between
      .map(endpoint => `${alias}.${quoteIdentifier(`${endpoint.field}.id`)}`)
      .join(', ')
  }

  #helperName(grant: GraphGrant): string {
    const hash = createHash('sha256')
      .update(JSON.stringify({ predicate: grant.predicate, target: grant.target }))
      .digest('hex')
      .slice(0, 16)
    return `basis.policy_${hash}`
  }

  #searchPath(): string {
    return this.#schema === 'public'
      ? 'public, basis, pg_temp'
      : `${this.#schema}, public, basis, pg_temp`
  }

  #identityFunctions(): PhysicalFunction[] {
    const userLeaves = this.definitions.concreteDescendants('User')
    const userFields = this.definitions.entity('User')?.effectiveFields ?? []
    const email = userFields.some(field => field.name === 'email')
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
    const userEntity = userLeaves.length === 1 ? userLeaves[0].name : null
    const enrollSql = this.#enrollSql(
      userEntity,
      email,
      userLeaves.map(entity => entity.name),
    )
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

  #enrollSql(
    userEntity: string | null,
    email: boolean,
    userLeaves: readonly string[],
  ): string {
    const ancestry = userEntity === null ? [] : this.definitions.ancestry(userEntity)
    const userInserts = ancestry
      .filter(name => name !== 'Entity')
      .reverse()
      .map(name => {
        if (name === 'User' && email) {
          return 'INSERT INTO "User" ("id", "email") VALUES (user_id, email_address);'
        }
        return `INSERT INTO ${quoteIdentifier(name)} ("id") VALUES (user_id);`
      })
      .join('\n        ')
    const detail = userLeaves.length === 0
      ? 'no concrete User descendants'
      : `multiple concrete User descendants: ${userLeaves.join(', ')}`
    const creation = userEntity === null
      ? `RAISE EXCEPTION ${literal(`Basis identity enrollment is ambiguous: ${detail}`)};`
      : `INSERT INTO "Entity" ("id", "name", "entity") VALUES (user_id, user_name, ${literal(userEntity)});
        ${userInserts}`
    return `
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
        ${creation}
        identity_id := gen_random_uuid()::text;
        INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (identity_id, provider_name || ':' || provider_subject, 'ExternalIdentity');
        INSERT INTO "ExternalIdentity" ("id", "provider", "subject", "revoked", "user.id")
          VALUES (identity_id, provider_name, provider_subject, false, user_id);
        RETURN user_id;
      END $$;
    `
  }

  #policyFunctions(): PhysicalFunction[] {
    const functions: PhysicalFunction[] = []
    const seen = new Set<string>()
    for (const grant of this.grants) {
      if (!grant.predicate) continue
      const name = this.#helperName(grant)
      if (seen.has(name)) continue
      seen.add(name)
      const entity = grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target)
      if (!entity) throw new Error(`Graph: unknown predicate target "${grant.target}"`)
      const relationship = this.definitions.relationship(grant.target)
      const signature = relationship ? 'root_a text, root_b text' : 'root_id text'
      const condition = relationship
        ? relationshipKeyCondition(relationship)
        : `"__row".${quoteIdentifier('id')} = root_id`
      const compiled = compileEntityPredicate(this.definitions, entity, grant.predicate, '__row')
      const predicate = `(${inline(compiled.sql, compiled.values)})`
      const joins = compiled.joins.length === 0 ? '' : ` ${compiled.joins.join(' ')}`
      const withClause = compiled.ctes.length === 0 ? '' : `WITH ${compiled.ctes.join(', ')} `
      const sql = `
        CREATE OR REPLACE FUNCTION ${name}(${signature})
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${this.#searchPath()} AS $$
          ${withClause}SELECT EXISTS (
            SELECT 1
            FROM ${quoteIdentifier(grant.target)} AS "__row"${joins}
            WHERE ${condition}
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
        signature,
        sql,
      })
    }
    return functions
  }

  #manageExpression(target: string): string | null {
    const targets = new Set([...this.#ancestry(target), target])
    const conditions = this.grants
      .filter(grant => grant.action === Action.Manage && targets.has(grant.target))
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
    return relationship ? relationshipEntityDefinition(relationship) : undefined
  }

  #indexes(): PhysicalIndex[] {
    const indexes: PhysicalIndex[] = []
    const external = this.definitions.entity('ExternalIdentity')
    if (external) {
      indexes.push({
        columns: ['provider', 'subject'],
        name: 'ExternalIdentity_provider_subject_key',
        operatorClasses: [],
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
          operatorClasses: [],
          sql: 'CREATE INDEX IF NOT EXISTS "UserRole_user_idx" ON "UserRole" ("user.id")',
          table: 'UserRole',
        },
        {
          columns: ['role.id'],
          name: 'UserRole_role_idx',
          operatorClasses: [],
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
    grants.push({
      grantName: 'grant:PUBLIC:schema:public:CREATE',
      grantee: 'PUBLIC',
      kind: 'revoke',
      name: 'revoke:grant:PUBLIC:schema:public:CREATE',
      object: 'schema',
      privilege: 'CREATE',
      sql: 'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
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
 * @param enums - Optional explicit enum override.
 * @returns The authored document with normalized entities and relationships.
 */
function normalizeDocument(
  document: GraphAuthoringDocument,
  relationships: GraphOptions['relationships'],
  enums: GraphOptions['enums'],
): GraphAuthoringDocument {
  if (document.entities !== undefined && !Array.isArray(document.entities)) {
    throw new Error('Graph: entities must be an authored document or entity array')
  }
  if (document.enums !== undefined && enums !== undefined) {
    throw new Error('Graph: enums are declared both in the document and graph options')
  }
  return {
    ...document,
    ...(enums === undefined ? {} : { enums }),
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
      return {
        entities: parsed,
        ...(options.enums === undefined ? {} : { enums: options.enums }),
        relationships: options.relationships,
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Graph: entities must be an authored document or entity array')
    }
    return normalizeDocument(
      parsed as GraphAuthoringDocument,
      options.relationships,
      options.enums,
    )
  }
  if (isAuthoredEntityArray(input)) {
    return {
      entities: input,
      ...(options.enums === undefined ? {} : { enums: options.enums }),
      relationships: options.relationships,
    }
  }
  if (input && typeof input === 'object') {
    return normalizeDocument(input as GraphAuthoringDocument, options.relationships, options.enums)
  }
  return {
    entities: [],
    ...(options.enums === undefined ? {} : { enums: options.enums }),
    relationships: options.relationships,
  }
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
 * Extract an authored security declaration from one entity or relationship.
 * @param value - Authored candidate.
 * @param security - Output map keyed by owner name.
 * @returns The candidate without its `security` property.
 */
function takeSecurity<T>(value: T, security: Map<string, unknown>): T {
  if (!isRecordLike(value) || !('security' in value)) return value
  const source = value as Record<string, unknown>
  const name = source.name
  if (typeof name === 'string') security.set(name, source.security)
  const rest: Record<string, unknown> = { ...source }
  delete rest.security
  return rest as T
}

/**
 * Normalize typed named capability declarations.
 * @param source - Capability declarations.
 * @returns Capabilities keyed by name.
 */
function capabilitiesFrom(source?: GrantSource): ReadonlyMap<string, GrantCapability> {
  const capabilities = new Map<string, GrantCapability>()
  if (source === undefined) return capabilities
  if (Array.isArray(source)) {
    throw new Error('Graph: target-bound grants are no longer supported; declare capabilities and security')
  }
  for (const [name, details] of Object.entries(source)) {
    if (name.trim().length === 0) throw new Error('Graph: capability names must be non-empty')
    if (!isRecordLike(details)) {
      throw new Error(`Graph: capability "${name}" must be an object`)
    }
    capabilities.set(name, {
      ...(typeof details.description === 'string' ? { description: details.description } : {}),
      name,
    })
  }
  return capabilities
}

/**
 * Whether a value is a plain non-array object.
 * @param value - Candidate value.
 * @returns Whether it is an object.
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
      grants: [...(details.grants ?? [])],
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
 * Whether one predicate contains a collection comparison.
 * @param filter - Canonical predicate.
 * @returns Whether a collection filter is present.
 */
function filterContainsCollection(filter: Filter): boolean {
  if ('filters' in filter) {
    return 'field' in filter || filter.filters.some(child => filterContainsCollection(child))
  }
  return false
}

/**
 * Whether a canonical predicate can be evaluated directly against a proposed row.
 * @param filter - Canonical predicate.
 * @returns `true` when all paths are local or one reference hop.
 */
function rowPredicateSupported(filter: Filter): boolean {
  if ('filters' in filter) {
    if ('field' in filter) return false
    return filter.filters.every(child => rowPredicateSupported(child))
  }
  if (filter.field.split('.').length > 2) return false
  return !isFieldOperand(filter.value) || filter.value.$field.split('.').length <= 2
}

/**
 * Build the row-identity condition for one relationship policy helper.
 * @param relationship - Named relationship definition.
 * @returns SQL condition over both endpoint identities.
 */
function relationshipKeyCondition(relationship: RelationshipDefinition): string {
  return relationship.between.map((endpoint, index) => (
    `"__row".${quoteIdentifier(`${endpoint.field}.id`)} = root_${index === 0 ? 'a' : 'b'}`
  )).join(' AND ')
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
 * Normalize one action literal.
 * @param action - Action input.
 * @returns The validated action.
 */
function actionValue(action: string): Action {
  if (!Object.values(Action).includes(action as Action)) {
    throw new Error(`Graph: unknown action "${action}"`)
  }
  return action as Action
}
