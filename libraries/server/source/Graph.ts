import { createHash } from 'node:crypto'
import type { DerivedCollectionDefinition, EntityDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { EntityDefinitions, FieldType, identityDefinition, isCanonicalUUID } from './EntityDefinitions'
import type { AuthoredDocument, AuthoredEntity, AuthoredRelationship } from './GraphAuthoring'
import { Operator } from './Operator'
import type { CollectionFilterScope, Filter } from './Predicate'
import { Predicate } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { PhysicalFunction, PhysicalGrant, PhysicalIndex, PhysicalPolicy, PhysicalSchema, PhysicalTable } from './Schema'
import type { CollectionScope, QueryScope } from './SQL'
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

/** One typed named capability declaration. */
export interface GrantCapability {
  /** Optional human-readable capability description. */
  readonly description?: string,
  /** Capability name used by security rules and role assignments. */
  readonly name: string,
}

/** Named capability declarations or the legacy target-bound grant list. */
export type GrantSource =
  | Readonly<Record<string, { readonly description?: string }>>
  | readonly GrantDefinition[]

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
  /** Graph-defined permission declarations. */
  readonly grants?: GrantSource,
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
    const legacy = Array.isArray(options.grants)
      ? options.grants.map(grant => this.#normalizeGrant(grant))
      : []
    this.grants = [...legacy, ...this.#expandSecurity()]
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
      ...(application.relationships === undefined ? {} : { relationships: application.relationships }),
      ...(this.#options.grants === undefined ? {} : { grants: this.#options.grants }),
      ...(this.#options.roles === undefined ? {} : { roles: this.#options.roles }),
      ...(this.#options.schema === undefined ? {} : { schema: this.#options.schema }),
    }
  }

  /**
   * Every normalized declarative constraint in the graph.
   * @returns Canonical uniqueness constraints.
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
    const targets = new Set(['*', ...this.#ancestry(target)])
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
      if (hasGrant === hasRole) {
        throw new Error(
          `Graph: security rule for "${owner}" must declare exactly one of grant or role, ` +
          'or use Security.Public',
        )
      }
      const where = candidate.where === undefined || candidate.where === null
        ? null
        : this.#normalizePredicate(owner, candidate.where as GrantDefinition['predicate'])
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
      if (typeof candidate.role !== 'string') {
        throw new Error(`Graph: security role for "${owner}" must be a string`)
      }
      const role = this.role(candidate.role)
      if (!role) throw new Error(`Graph: unknown role "${candidate.role}"`)
      if (role.id === PUBLIC_ROLE_ID) {
        throw new Error(`Graph: security for "${owner}" must use Security.Public for public access`)
      }
      return { role: role.id, where }
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
      if (grant.action === Action.Create && grant.predicate && filterContainsCollection(grant.predicate)) {
        throw new Error('Graph: create grants cannot use collection predicates')
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
      const entity = identityDefinition()
      const collection = (name: string): CollectionFilterScope | undefined => (
        this.#collectionFilterScope(entity, name)
      )
      const filter = typeof input === 'string'
        ? QueryNormalizer.normalize(entity, input, name => policyField(entity, name), collection)
        : Predicate.normalize(entity, input, name => policyField(entity, name), collection)
      if (filter) assertPolicySafe(filter)
      return filter
    }
    const entity = this.#policyEntity(target)
    if (!entity) throw new Error(`Graph: unknown grant target "${target}"`)
    const collection = (name: string): CollectionFilterScope | undefined => (
      this.#collectionFilterScope(entity, name)
    )
    const filter = typeof input === 'string'
      ? QueryNormalizer.normalize(entity, input, name => policyField(entity, name), collection)
      : Predicate.normalize(entity, input, name => policyField(entity, name), collection)
    if (filter) assertPolicySafe(filter)
    return filter
  }

  /**
   * Resolve a collection navigation for policy normalization.
   * @param entity - Entity whose collection is referenced.
   * @param name - Collection navigation name.
   * @returns Collection scope, or undefined when not a collection.
   */
  #collectionFilterScope(
    entity: EntityDefinition,
    name: string,
  ): CollectionFilterScope | undefined {
    const collection = entity.collections.find(candidate => candidate.name === name)
    if (!collection) return undefined
    const target = this.#collectionTarget(collection)
    return {
      definition: target,
      field: path => this.#collectionField(collection, target, path),
    }
  }

  /**
   * Resolve the target entity of one collection navigation.
   * @param collection - Collection metadata.
   * @returns Target entity definition.
   */
  #collectionTarget(collection: DerivedCollectionDefinition): EntityDefinition {
    if (collection.target === 'Entity') return identityDefinition()
    const target = this.#policyEntity(collection.target)
    if (!target) throw new Error(`Graph: unknown collection target "${collection.target}"`)
    return target
  }

  /**
   * Resolve one member field inside an authorization collection.
   * @param collection - Collection metadata.
   * @param target - Collection target entity.
   * @param path - Member path or named-relationship property.
   * @returns Policy-safe field metadata.
   */
  #collectionField(
    collection: DerivedCollectionDefinition,
    target: EntityDefinition,
    path: string,
  ): QueryFieldDefinition {
    const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
    if (collection.kind === 'relationship') {
      const prefix = `${lowerFirst(collection.relationship.name)}.`
      if (normalized.startsWith(prefix)) {
        const propertyName = normalized.slice(prefix.length)
        const property = collection.relationship.fields.find(candidate => candidate.name === propertyName)
        if (!property) {
          throw new Error(
            `Graph: unknown relationship field "${collection.relationship.name}.${propertyName}"`,
          )
        }
        if (property.type === FieldType.Array || property.type === FieldType.JSON) {
          throw new Error(
            `Graph: relationship field "${collection.relationship.name}.${propertyName}" is not policy-safe`,
          )
        }
        return { ...property, name: normalized }
      }
    }
    return policyField(target, normalized)
  }

  /**
   * Build the correlated SQL scope for one authorization collection.
   * @param entity - Entity whose collection is referenced.
   * @param name - Collection navigation name.
   * @param parentAlias - Alias of the resource row being authorized.
   * @returns Collection scope, or undefined when not a collection.
   */
  #collectionSqlScope(
    entity: EntityDefinition,
    name: string,
    parentAlias: string,
  ): CollectionScope | undefined {
    const collection = entity.collections.find(candidate => candidate.name === name)
    if (!collection) return undefined
    const target = this.#collectionTarget(collection)
    const suffix = name.replace(/[^A-Za-z0-9_]/gu, '_')
    const relationshipAlias = `__policy_${suffix}_rel`
    const targetAlias = `__policy_${suffix}_target`
    const rootAlias = `__policy_${suffix}_root`
    let relation: string
    let condition: string
    if (collection.kind === 'inverse') {
      if (collection.target === 'Entity') {
        throw new Error(`Graph: inverse collection "${name}" cannot target Entity in a policy`)
      }
      relation = `${quoteIdentifier(collection.target)} AS ${quoteIdentifier(targetAlias)} ` +
        `JOIN "Entity" AS ${quoteIdentifier(rootAlias)} ` +
        `ON ${quoteIdentifier(rootAlias)}.${quoteIdentifier('id')} = ` +
        `${quoteIdentifier(targetAlias)}.${quoteIdentifier('id')}`
      condition = `${quoteIdentifier(targetAlias)}.${quoteIdentifier(collection.reference.column)} = ` +
        `${quoteIdentifier(parentAlias)}.${quoteIdentifier('id')}`
    } else {
      const relationship = collection.relationship
      const local = relationship.between[collection.endpoint]
      const remote = relationship.between[collection.endpoint === 0 ? 1 : 0]
      const remoteColumn = `${remote.field}.id`
      relation = `${quoteIdentifier(relationship.name)} AS ${quoteIdentifier(relationshipAlias)}`
      if (collection.target === 'Entity') {
        relation += ` JOIN "Entity" AS ${quoteIdentifier(rootAlias)} ` +
          `ON ${quoteIdentifier(rootAlias)}.${quoteIdentifier('id')} = ` +
          `${quoteIdentifier(relationshipAlias)}.${quoteIdentifier(remoteColumn)}`
      } else {
        relation += ` JOIN ${quoteIdentifier(collection.target)} AS ${quoteIdentifier(targetAlias)} ` +
          `ON ${quoteIdentifier(targetAlias)}.${quoteIdentifier('id')} = ` +
          `${quoteIdentifier(relationshipAlias)}.${quoteIdentifier(remoteColumn)} ` +
          `JOIN "Entity" AS ${quoteIdentifier(rootAlias)} ` +
          `ON ${quoteIdentifier(rootAlias)}.${quoteIdentifier('id')} = ` +
          `${quoteIdentifier(targetAlias)}.${quoteIdentifier('id')}`
      }
      condition = `${quoteIdentifier(relationshipAlias)}.${quoteIdentifier(`${local.field}.id`)} = ` +
        `${quoteIdentifier(parentAlias)}.${quoteIdentifier('id')}`
    }
    const expressions = new Map<string, string>()
    const resolve = (path: string): QueryFieldDefinition => {
      const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
      if (collection.kind === 'relationship') {
        const prefix = `${lowerFirst(collection.relationship.name)}.`
        if (normalized.startsWith(prefix)) {
          const propertyName = normalized.slice(prefix.length)
          const property = collection.relationship.fields.find(candidate => candidate.name === propertyName)
          if (!property) {
            throw new Error(
              `Graph: unknown relationship field "${collection.relationship.name}.${propertyName}"`,
            )
          }
          if (property.type === FieldType.Array || property.type === FieldType.JSON) {
            throw new Error(
              `Graph: relationship field "${collection.relationship.name}.${propertyName}" is not policy-safe`,
            )
          }
          expressions.set(normalized, `${quoteIdentifier(relationshipAlias)}.${quoteIdentifier(property.name)}`)
          return { ...property, name: normalized }
        }
      }
      const field = policyField(target, normalized)
      const root = normalized.split('.', 1)[0] ?? normalized
      const source = target.effectiveFields.find(candidate => candidate.name === root)
      if (!source) throw new Error(`Graph: unknown collection field "${target.name}.${normalized}"`)
      if (source.owner !== 'Entity' && source.owner !== target.name) {
        throw new Error(
          `Graph: inherited collection field "${target.name}.${normalized}" is not policy-safe`,
        )
      }
      const expression = source.owner === 'Entity'
        ? `${quoteIdentifier(rootAlias)}.${quoteIdentifier(field.name)}`
        : `${quoteIdentifier(targetAlias)}.${quoteIdentifier(field.name)}`
      expressions.set(field.name, expression)
      return field
    }
    return {
      condition,
      definition: target,
      expression: field => {
        const expression = expressions.get(field.name)
        if (!expression) throw new Error(`Graph: unresolved collection field "${field.name}"`)
        return expression
      },
      field: resolve,
      relation,
    }
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
    const conditions = this.#actionConditions(leaf, action, alias, roleOnly, table)
    if (conditions.length === 0) return null
    if (action === Action.Read || roleOnly) return `(${conditions.join(' OR ')})`
    if (action !== Action.Create && action !== Action.Update && action !== Action.Delete) {
      return `(${conditions.join(' OR ')})`
    }
    const readable = this.#actionConditions(leaf, Action.Read, alias, false, table)
    if (readable.length === 0) return null
    return `((${readable.join(' OR ')}) AND (${conditions.join(' OR ')}))`
  }

  /**
   * Compile the direct action rules before the READ prerequisite is applied.
   * @param leaf - Concrete entity or relationship table.
   * @param action - Action being evaluated.
   * @param alias - Row alias.
   * @param roleOnly - Whether predicates are omitted.
   * @param table - Grant target table.
   * @returns Matching rule expressions.
   */
  #actionConditions(
    leaf: string,
    action: Action,
    alias: string,
    roleOnly: boolean,
    table: string,
  ): string[] {
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
    return conditions
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
        const field = entity.effectiveFields.find(candidate => candidate.name === name)
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
      collection: name => this.#collectionSqlScope(entity, name, alias),
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
    const targets = new Set(['*', ...this.#ancestry(target), target])
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
      constraints: relationship.constraints,
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
 * @param source - Capability declarations or legacy grants.
 * @returns Capabilities keyed by name.
 */
function capabilitiesFrom(source?: GrantSource): ReadonlyMap<string, GrantCapability> {
  const capabilities = new Map<string, GrantCapability>()
  if (source === undefined || Array.isArray(source)) return capabilities
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
 * Lowercase only the first character of a relationship name.
 * @param value - Relationship name.
 * @returns Its nested member-property prefix.
 */
function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`
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
 * Whether a filter is the canonical `$all` lowering.
 * @param filter - Canonical predicate.
 * @returns Whether it is `Not(Contains(Not(P)))`.
 */
function isUniversalCollectionFilter(filter: Filter): boolean {
  if (!('filters' in filter) || 'field' in filter || filter.operator !== Operator.Logical.Not) {
    return false
  }
  const child = filter.filters[0]
  if (!child || !('filters' in child) || !('field' in child)
    || child.operator !== Operator.Comparison.Contains || child.filters.length !== 1) {
    return false
  }
  const requirement = child.filters[0]
  return Boolean(requirement && 'filters' in requirement && !('field' in requirement)
    && requirement.operator === Operator.Logical.Not)
}

/**
 * Reject predicate constructs that are not safe in a static policy.
 * @param filter - Canonical predicate.
 * @param insideCollection - Whether the current node is inside a member requirement.
 * @param containsByCollection - Collections already used by one `$contains` requirement.
 */
function assertPolicySafe(
  filter: Filter,
  insideCollection = false,
  containsByCollection = new Set<string>(),
): void {
  if ('filters' in filter) {
    if (isUniversalCollectionFilter(filter)) {
      throw new Error('Graph: $all collection policy predicates are not supported')
    }
    if ('field' in filter) {
      if (insideCollection) {
        throw new Error('Graph: nested collection policy predicates are not supported')
      }
      if (filter.operator === Operator.Collection.All) {
        throw new Error('Graph: $all collection policy predicates are not supported')
      }
      if (filter.operator !== Operator.Comparison.Contains
        && filter.operator !== Operator.Comparison.Empty) {
        throw new Error(`Graph: collection operator "${filter.operator}" is not policy-safe`)
      }
      if (filter.operator === Operator.Comparison.Contains) {
        if (filter.filters.length !== 1) {
          throw new Error('Graph: collection $contains requires exactly one member requirement')
        }
        if (containsByCollection.has(filter.field)) {
          throw new Error(`Graph: collection "${filter.field}" has multiple $contains requirements`)
        }
        containsByCollection.add(filter.field)
      } else if (filter.filters.length !== 0) {
        throw new Error('Graph: collection $empty cannot carry member requirements')
      }
      for (const child of filter.filters) {
        assertPolicySafe(child, true, containsByCollection)
      }
      return
    }
    for (const child of filter.filters) {
      assertPolicySafe(child, insideCollection, containsByCollection)
    }
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
    return [
      ...('field' in filter ? [filter.field] : []),
      ...filter.filters.flatMap(child => filterFieldNames(child)),
    ]
  }
  return 'field' in filter ? [filter.field] : []
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
