import { createHash } from 'node:crypto'
import { resolveCollectionRelation } from './CollectionRelation'
import { collectionSqlRelation } from './CollectionSql'
import type { DerivedCollectionDefinition, EffectiveFieldDefinition, EntityDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { Constraint, EntityDefinitions, FieldType, identityDefinition, isCanonicalUUID } from './EntityDefinitions'
import type { AuthoredDocument, AuthoredEntity, AuthoredEnumSource, AuthoredRelationship, AuthoredSecurity } from './GraphAuthoring'
import { Operator } from './Operator'
import { resolveCollectionMember, resolveCollectionPath, resolveFieldPath, resolvePredicatePath } from './PathResolution'
import { postgresScalarType } from './PostgresTypes'
import type { ArrayFilterScope, CollectionFilterScope, Filter } from './Predicate'
import { ACTOR_FIELD_NAME, Predicate } from './Predicate'
import { PredicateEligibility } from './PredicateEligibility'
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
  /** Named reusable enum declarations. */
  readonly enums?: AuthoredEnumSource,
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
      enums: { ...(application.enums ?? {}), ...(options.enums ?? {}) },
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
    const enums = { ...(application.enums ?? {}), ...(this.#options.enums ?? {}) }
    return {
      ...(application.entities === undefined ? {} : { entities: application.entities }),
      ...(Object.keys(enums).length === 0 ? {} : { enums }),
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
   * The physical schema this Graph installs into.
   * @returns The schema name.
   */
  get schema(): string {
    return this.#schema
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
    const functions = [
      ...base.functions,
      ...this.#policyFunctions(),
      ...this.#validationFunctions(),
      ...this.#createHelperFunctions(),
    ]
    return {
      ...base,
      extensions: ['pg_trgm'],
      functions,
      grants: this.#grants(appRole),
      policies,
      roles: this.roles
        .filter(role => role.id !== PUBLIC_ROLE_ID)
        .map(role => ({
          ...(role.description === undefined ? {} : { description: role.description }),
          id: role.id,
          name: role.name,
        })),
      schemas: [],
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
    const creatable = this.#rowExpression(target, Action.Create, row)
    if (!creatable) return null
    const readable = this.#rowExpression(target, Action.Read, row)
    if (!readable) return null
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
      const role = roleCondition(grant.role, this.#schema)
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
      field: name => this.#policyPathField(entity, name),
    }
    const where = SQL.whereFilter(this.definitions, entity.name, grant.predicate as Filter, scope)
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
    }
  }

  #normalizePredicate(
    target: string,
    input: PredicateInput,
  ): Filter | null {
    if (input === null || input === undefined) return null
    const entity = this.#policyEntity(target)
    if (!entity) throw new Error(`Graph: unknown security target "${target}"`)
    const collection = (name: string): CollectionFilterScope | undefined => (
      this.#collectionFilterScope(entity, name)
    )
    const field = (name: string): QueryFieldDefinition => this.#policyPathField(entity, name)
    const array = (name: string): ArrayFilterScope | undefined => this.#policyArrayScope(entity, name)
    const filter = typeof input === 'string'
      ? QueryNormalizer.normalize(entity, input, field, collection, array)
      : Predicate.normalize(entity, input, field, collection, array)
    if (!filter) return null
    assertPolicySafe(filter)
    return PredicateEligibility.lower(this.definitions, entity, filter)
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
    const resolved = resolveCollectionPath(entity, name, {
      resolve: value => this.#policyEntity(value),
    })
    if (!resolved) return this.#canonicalCollectionFilterScope(entity, name)
    if ('kind' in resolved) {
      const canonical = this.#canonicalCollectionFilterScope(entity, name)
      if (canonical) return canonical
      if (resolved.kind === 'depth') {
        throw new Error(`Graph: collection path "${name}" exceeds the maximum depth`)
      }
      return undefined
    }
    const target = this.#collectionTarget(resolved.collection)
    return {
      array: nested => this.#policyArrayScope(target, nested),
      collection: nested => this.#collectionFilterScope(target, nested),
      definition: target,
      field: path => this.#collectionField(resolved.collection, target, path),
    }
  }

  /**
   * Resolve one polymorphic collection navigation for policy normalization.
   * @param entity - Entity whose collection is referenced.
   * @param name - Logical collection path.
   * @returns Collection filter scope, or undefined.
   */
  #canonicalCollectionFilterScope(
    entity: EntityDefinition,
    name: string,
  ): CollectionFilterScope | undefined {
    const resolved = resolvePredicatePath(entity, name, { definitions: this.definitions })
    if ('kind' in resolved) return undefined
    const collection = resolved.terminal
    if (!('kind' in collection)) return undefined
    const target = this.#collectionTarget(collection)
    return {
      array: nested => this.#policyArrayScope(target, nested),
      collection: nested => this.#collectionFilterScope(target, nested),
      definition: target,
      field: path => this.#collectionField(collection, target, path),
    }
  }

  /**
   * Resolve one native-array navigation for a policy predicate.
   * @param entity - Policy entity owning the array.
   * @param name - Logical array field or dotted reference path.
   * @returns The array member scope, or undefined.
   */
  #policyArrayScope(entity: EntityDefinition, name: string): ArrayFilterScope | undefined {
    try {
      const field = this.#policyPathField(entity, name)
      if (field.type !== FieldType.Array) return undefined
      return {
        field,
        member: {
          ...(field.items.format ? { format: field.items.format } : {}),
          name: field.name,
          type: field.items.type,
        },
      }
    } catch {
      return undefined
    }
  }

  /**
   * Resolve one field or dotted reference path for policy normalization.
   * @param entity - Policy entity where the path starts.
   * @param name - Logical field or dotted reference path.
   * @returns The terminal field definition.
   */
  #policyPathField(entity: EntityDefinition, name: string): QueryFieldDefinition {
    if (name === ACTOR_FIELD_NAME) return { name: ACTOR_FIELD_NAME, type: FieldType.ID }
    const resolved = resolveFieldPath(entity, name, {
      resolve: value => this.#policyEntity(value),
    })
    if ('kind' in resolved) {
      const canonical = this.#canonicalPolicyPathField(entity, name)
      if (canonical) return canonical
      if (resolved.kind === 'unknown') throw new Error(`Graph: unknown field "${entity.name}.${name}"`)
      if (resolved.kind === 'non-reference') {
        throw new Error(`Graph: reference field "${entity.name}.${name}" is not policy-safe`)
      }
      throw new Error(`Graph: reference path "${name}" exceeds the maximum depth`)
    }
    if (resolved.identity) {
      return { name: name.endsWith('.id') ? name : `${name}.id`, type: FieldType.ID }
    }
    return resolved.field
  }

  /**
   * Resolve one polymorphic policy scalar or reference path.
   * @param entity - Policy entity where the path starts.
   * @param name - Logical path.
   * @returns The terminal field, or undefined when the path is not a scalar.
   */
  #canonicalPolicyPathField(
    entity: EntityDefinition,
    name: string,
  ): QueryFieldDefinition | undefined {
    const resolved = resolvePredicatePath(entity, name, { definitions: this.definitions })
    if ('kind' in resolved || 'kind' in resolved.terminal) return undefined
    return resolved.terminal
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
    const resolved = resolveCollectionMember(collection, target, path, {
      resolve: value => this.#policyEntity(value),
    })
    const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
    const prefix = 'relationship' in collection
      ? `${lowerFirst(collection.relationship.name)}.`
      : ''
    if ('kind' in resolved) {
      const canonical = this.#canonicalPolicyPathField(target, normalized)
      if (canonical) return canonical
      if ('relationship' in collection && normalized.startsWith(prefix)) {
        throw new Error(
          'Graph: unknown relationship field ' +
          `"${collection.relationship.name}.${normalized.slice(prefix.length)}"`,
        )
      }
      throw new Error(`Graph: unknown field "${target.name}.${path}"`)
    }
    if (resolved.relationshipProperty && (resolved.field.type === FieldType.Array
      || resolved.field.type === FieldType.JSON)) {
      throw new Error(`Graph: relationship field "${normalized}" is not policy-safe`)
    }
    return resolved.field
  }
  /**
   * Build one field/path resolver for a policy row.
   * @param entity - Policy entity view where the path starts.
   * @param baseAlias - Alias of the table owning local entity fields, when present.
   * @param rootAlias - Alias of the joined `Entity` root row, when present.
   * @param allowSubqueries - Whether inherited fields may be read through correlated subqueries.
   * @param nextAlias - Allocator for one collision-free subquery alias.
   * @param parentId - Identity expression for a row reached through a reference hop.
   * @returns A resolver for one logical path.
   */
  #policyResolver(
    entity: EntityDefinition,
    baseAlias: string | undefined,
    rootAlias: string | undefined,
    allowSubqueries: boolean,
    nextAlias: () => string,
    parentId?: string,
  ): (path: string) => { readonly expression: string, readonly field: QueryFieldDefinition } {
    const cache = new Map<string, { readonly expression: string, readonly field: QueryFieldDefinition }>()
    const resolve = (path: string): { readonly expression: string, readonly field: QueryFieldDefinition } => {
      const cached = cache.get(path)
      if (cached) return cached
      if (path === ACTOR_FIELD_NAME) {
        const actor = { expression: '', field: { name: ACTOR_FIELD_NAME, type: FieldType.ID as const } }
        cache.set(path, actor)
        return actor
      }
      const resolved = resolveFieldPath(entity, path, {
        resolve: value => this.#policyEntity(value),
      })
      if ('kind' in resolved) {
        const canonical = this.#canonicalPolicyExpression(
          entity,
          path,
          baseAlias,
          rootAlias,
          allowSubqueries,
          nextAlias,
          parentId,
        )
        if (canonical) {
          cache.set(path, canonical)
          return canonical
        }
        if (resolved.kind === 'unknown') throw new Error(`Graph: unknown field "${entity.name}.${path}"`)
        if (resolved.kind === 'non-reference') {
          throw new Error(`Graph: reference field "${entity.name}.${path}" is not policy-safe`)
        }
        throw new Error(`Graph: reference path "${path}" exceeds the maximum depth`)
      }
      let current = entity
      let currentBase = baseAlias
      let currentRoot = rootAlias
      let currentParent = parentId
      for (const hop of resolved.hops) {
        const expression = this.#policyFieldExpression(
          hop.field,
          current,
          currentBase,
          currentRoot,
          currentParent,
          allowSubqueries,
          nextAlias,
        )
        const target = hop.field.target === 'Entity'
          ? identityDefinition()
          : this.#policyEntity(hop.field.target)
        if (!target) throw new Error(`Graph: unknown field "${entity.name}.${path}"`)
        current = target
        currentBase = undefined
        currentRoot = undefined
        currentParent = expression
      }
      const expression = this.#policyFieldExpression(
        resolved.terminal,
        current,
        currentBase,
        currentRoot,
        currentParent,
        true,
        nextAlias,
      )
      const result = resolved.identity
        ? { expression, field: { name: path, type: FieldType.ID as const } }
        : { expression, field: { ...resolved.terminal, name: path } as QueryFieldDefinition }
      cache.set(path, result)
      return result
    }
    return resolve
  }

  /**
   * Render one polymorphic policy scalar or reference path.
   * @param entity - Policy entity where the path starts.
   * @param path - Logical path.
   * @param baseAlias - Alias of the table owning the policy entity's local fields.
   * @param rootAlias - Alias of the joined `Entity` root row, when present.
   * @param allowSubqueries - Whether inherited fields may use correlated subqueries.
   * @param nextAlias - Allocator for one collision-free subquery alias.
   * @param parentId - Identity expression for a row reached through a reference hop.
   * @returns The SQL expression and field metadata, or undefined.
   * @throws {Error} When a canonical variant cannot be compiled.
   */
  #canonicalPolicyExpression(
    entity: EntityDefinition,
    path: string,
    baseAlias: string | undefined,
    rootAlias: string | undefined,
    allowSubqueries: boolean,
    nextAlias: () => string,
    parentId: string | undefined,
  ): { readonly expression: string, readonly field: QueryFieldDefinition } | undefined {
    const resolved = resolvePredicatePath(entity, path, { definitions: this.definitions })
    if ('kind' in resolved || 'kind' in resolved.terminal) return undefined
    const branches = resolved.variants.map(variant => {
      let currentEntity = entity
      let currentBase = baseAlias
      let currentRoot = rootAlias
      let currentParent = parentId
      let prefix = ''
      const occurrences = new Map<string, string>()
      const rootIdentity = rootAlias !== undefined
        ? `${rootAlias}.${quoteIdentifier('id')}`
        : baseAlias !== undefined
          ? `${baseAlias}.${quoteIdentifier('id')}`
          : currentParent
      if (rootIdentity) occurrences.set('', rootIdentity)
      for (const field of variant.fields.slice(0, -1)) {
        if ('kind' in field) {
          throw new Error(`Graph: policy path "${path}" contains a nested collection`)
        }
        if (field.type !== FieldType.Entity) {
          throw new Error(`Graph: policy path "${path}" traverses non-reference field "${field.name}"`)
        }
        const expression = this.#policyFieldExpression(
          field,
          currentEntity,
          currentBase,
          currentRoot,
          currentParent,
          allowSubqueries,
          nextAlias,
        )
        const target = field.target === 'Entity'
          ? identityDefinition()
          : this.#policyEntity(field.target)
        if (!target) throw new Error(`Graph: policy path "${path}" has unknown target`)
        currentEntity = target
        currentBase = undefined
        currentRoot = undefined
        currentParent = expression
        prefix = prefix === '' ? field.name : `${prefix}.${field.name}`
        occurrences.set(prefix, expression)
      }
      const terminal = variant.fields.at(-1)
      if (!terminal || 'kind' in terminal) {
        throw new Error(`Graph: policy path "${path}" has no scalar terminal`)
      }
      const expression = this.#policyFieldExpression(
        terminal,
        currentEntity,
        currentBase,
        currentRoot,
        currentParent,
        true,
        nextAlias,
      )
      const guards = variant.restrictions.map(restriction => {
        const prefixName = restriction.path === 'entity'
          ? ''
          : restriction.path.slice(0, -'.entity'.length)
        const identity = occurrences.get(prefixName)
        if (identity === undefined) {
          throw new Error(
            `Graph: policy path "${path}" restriction "${restriction.path}" ` +
            'has no physical occurrence',
          )
        }
        return `(SELECT ${quoteIdentifier('entity')} FROM ${quoteIdentifier('Entity')} ` +
          `WHERE ${quoteIdentifier('id')} = ${identity}) IN (` +
          `${restriction.entityTypes.map(type => literal(type)).join(', ')})`
      })
      return {
        expression,
        guard: guards.length === 0 ? 'TRUE' : guards.join(' AND '),
      }
    })
    const [first] = branches
    if (!first) throw new Error(`Graph: policy path "${path}" has no physical variants`)
    return {
      expression: branches.length === 1 && first.guard === 'TRUE'
        ? first.expression
        : `CASE ${branches.map(branch => (
          `WHEN ${branch.guard} THEN ${branch.expression}`
        )).join(' ')} ELSE NULL END`,
      field: resolved.terminal,
    }
  }

  /**
   * Render one policy field expression against a row or correlated identity.
   * @param field - Effective field to render.
   * @param entity - Entity view owning the field metadata.
   * @param baseAlias - Alias of the table owning local entity fields, when present.
   * @param rootAlias - Alias of the joined `Entity` root row, when present.
   * @param parentId - Identity expression for a row reached through a reference hop.
   * @param allowSubqueries - Whether inherited fields may use correlated subqueries.
   * @param nextPolicyFieldAlias - Allocator for one collision-free subquery alias.
   * @returns The SQL field expression.
   */
  #policyFieldExpression(
    field: EffectiveFieldDefinition,
    entity: EntityDefinition,
    baseAlias: string | undefined,
    rootAlias: string | undefined,
    parentId: string | undefined,
    allowSubqueries: boolean,
    nextPolicyFieldAlias: () => string,
  ): string {
    const column = field.type === FieldType.Entity ? field.column : field.name
    if (field.type !== FieldType.Entity && field.name === 'id' && baseAlias !== undefined) {
      return `${baseAlias}.${quoteIdentifier('id')}`
    }
    if (baseAlias !== undefined && field.owner === entity.name) {
      return `${baseAlias}.${quoteIdentifier(column)}`
    }
    if (rootAlias !== undefined && field.owner === 'Entity') {
      return `${rootAlias}.${quoteIdentifier(column)}`
    }
    if (!allowSubqueries) {
      throw new Error(`Graph: inherited policy field "${entity.name}.${field.name}" requires a helper`)
    }
    const identity = rootAlias !== undefined
      ? `${rootAlias}.${quoteIdentifier('id')}`
      : baseAlias !== undefined
        ? `${baseAlias}.${quoteIdentifier('id')}`
        : parentId
    if (!identity) {
      throw new Error(`Graph: inherited policy field "${entity.name}.${field.name}" has no row identity`)
    }
    const alias = nextPolicyFieldAlias()
    return `(SELECT ${quoteIdentifier(column)} FROM ${quoteIdentifier(field.owner)} ${alias} ` +
      `WHERE ${alias}.${quoteIdentifier('id')} = ${identity})`
  }

  /**
   * Build the correlated SQL scope for one authorization collection.
   * @param entity - Entity whose collection is referenced.
   * @param name - Collection navigation or dotted reference path.
   * @param parentAlias - Alias of the resource row being authorized.
   * @param baseAlias - Alias of the table owning the policy entity's local fields.
   * @param rootAlias - Alias of the joined `Entity` root row, when present.
   * @param allowSubqueries - Whether inherited fields may use correlated subqueries.
   * @param nextPolicyFieldAlias - Allocator for one collision-free subquery alias.
   * @param depth - Number of nested collection scopes.
   * @returns Collection scope, or undefined when not a collection.
   */
  #collectionSqlScope(
    entity: EntityDefinition,
    name: string,
    parentAlias: string,
    baseAlias: string | undefined,
    rootAlias: string | undefined,
    allowSubqueries: boolean,
    nextPolicyFieldAlias: () => string,
    depth = 0,
  ): CollectionScope | undefined {
    const resolved = resolveCollectionPath(entity, name, {
      resolve: value => this.#policyEntity(value),
    })
    if (!resolved) {
      return this.#canonicalCollectionSqlScope(
        entity,
        name,
        parentAlias,
        baseAlias,
        rootAlias,
        allowSubqueries,
        nextPolicyFieldAlias,
        depth,
      )
    }
    if ('kind' in resolved) {
      const canonical = this.#canonicalCollectionSqlScope(
        entity,
        name,
        parentAlias,
        baseAlias,
        rootAlias,
        allowSubqueries,
        nextPolicyFieldAlias,
        depth,
      )
      if (canonical) return canonical
      if (resolved.kind === 'depth') {
        throw new Error(`Graph: collection path "${name}" exceeds the maximum depth`)
      }
      return undefined
    }
    const collection = resolved.collection
    const row = this.#policyResolver(entity, baseAlias, rootAlias, allowSubqueries, nextPolicyFieldAlias)
    const parentId = resolved.prefix === ''
      ? `${parentAlias}.${quoteIdentifier('id')}`
      : row(resolved.prefix).expression
    return this.#collectionScopeForCollection(
      collection,
      parentId,
      depth,
      allowSubqueries,
      nextPolicyFieldAlias,
      `${depth}_${name.replace(/[^A-Za-z0-9_]/gu, '_')}`,
    )
  }

  /**
   * Build a collection scope from canonical physical path variants.
   * @param entity - Policy entity where the collection path starts.
   * @param name - Logical collection path.
   * @param parentAlias - Alias of the policy row being authorized.
   * @param baseAlias - Alias of the table owning the policy entity's local fields.
   * @param rootAlias - Alias of the joined `Entity` root row, when present.
   * @param allowSubqueries - Whether inherited fields may use correlated subqueries.
   * @param nextPolicyFieldAlias - Allocator for one collision-free subquery alias.
   * @param depth - Number of nested collection scopes.
   * @returns Variant-aware collection scope, or undefined.
   * @throws {Error} When a canonical physical variant cannot be compiled.
   */
  #canonicalCollectionSqlScope(
    entity: EntityDefinition,
    name: string,
    parentAlias: string,
    baseAlias: string | undefined,
    rootAlias: string | undefined,
    allowSubqueries: boolean,
    nextPolicyFieldAlias: () => string,
    depth: number,
  ): CollectionScope | undefined {
    const resolved = resolvePredicatePath(entity, name, { definitions: this.definitions })
    if ('kind' in resolved) return undefined
    const terminal = resolved.terminal
    if (!('kind' in terminal)) return undefined
    const scopes = resolved.variants.map((variant, index) => {
      let currentEntity = entity
      let currentBase = baseAlias
      let currentRoot = rootAlias
      let parentId = `${parentAlias}.${quoteIdentifier('id')}`
      let prefix = ''
      const occurrences = new Map<string, string>([['', parentId]])
      for (const field of variant.fields.slice(0, -1)) {
        if ('kind' in field) {
          throw new Error(`Graph: collection path "${name}" contains a nested collection`)
        }
        if (field.type !== FieldType.Entity) {
          throw new Error(`Graph: collection path "${name}" traverses non-reference field "${field.name}"`)
        }
        const expression = this.#policyFieldExpression(
          field,
          currentEntity,
          currentBase,
          currentRoot,
          parentId,
          allowSubqueries,
          nextPolicyFieldAlias,
        )
        const target = field.target === 'Entity'
          ? identityDefinition()
          : this.#policyEntity(field.target)
        if (!target) throw new Error(`Graph: collection path "${name}" has unknown target`)
        currentEntity = target
        currentBase = undefined
        currentRoot = undefined
        parentId = expression
        prefix = prefix === '' ? field.name : `${prefix}.${field.name}`
        occurrences.set(prefix, expression)
      }
      const terminalField = variant.fields.at(-1)
      if (!terminalField || !('kind' in terminalField)) {
        throw new Error(`Graph: collection path "${name}" has no collection terminal`)
      }
      const guards = variant.restrictions.map(restriction => {
        const prefixName = restriction.path === 'entity'
          ? ''
          : restriction.path.slice(0, -'.entity'.length)
        const identity = occurrences.get(prefixName)
        if (identity === undefined) {
          throw new Error(
            `Graph: collection path "${name}" restriction "${restriction.path}" ` +
            'has no physical occurrence',
          )
        }
        return `(SELECT ${quoteIdentifier('entity')} FROM ${quoteIdentifier('Entity')} ` +
          `WHERE ${quoteIdentifier('id')} = ${identity}) IN (` +
          `${restriction.entityTypes.map(type => literal(type)).join(', ')})`
      })
      return {
        guard: guards.length === 0 ? 'TRUE' : guards.join(' AND '),
        scope: this.#collectionScopeForCollection(
          terminalField,
          parentId,
          depth,
          allowSubqueries,
          nextPolicyFieldAlias,
          `${depth}_${index}_${name.replace(/[^A-Za-z0-9_]/gu, '_')}`,
        ),
      }
    })
    const [first] = scopes
    if (!first) throw new Error(`Graph: collection path "${name}" has no physical variants`)
    return { ...first.scope, variants: scopes }
  }

  /**
   * Build one correlated collection scope from a resolved collection and parent identity.
   * @param collection - Collection navigation.
   * @param parentId - Identity expression of the owning occurrence.
   * @param depth - Number of nested collection scopes.
   * @param allowSubqueries - Whether inherited fields may use correlated subqueries.
   * @param nextPolicyFieldAlias - Allocator for one collision-free subquery alias.
   * @param suffix - Unique alias suffix for this collection variant.
   * @returns The collection scope.
   */
  #collectionScopeForCollection(
    collection: DerivedCollectionDefinition,
    parentId: string,
    depth: number,
    allowSubqueries: boolean,
    nextPolicyFieldAlias: () => string,
    suffix: string,
  ): CollectionScope {
    const record = collection.kind === 'explicit' && collection.targetEndpoint === undefined
    const target = this.#collectionTarget(collection)
    const relationshipAlias = `__policy_${suffix}_rel`
    const targetAlias = `__policy_${suffix}_target`
    const rootAliasName = `__policy_${suffix}_root`
    const relation = resolveCollectionRelation(collection, value => this.#policyEntity(value))
    const sql = collectionSqlRelation(this.definitions, relation, parentId, {
      relationship: relationshipAlias,
      root: rootAliasName,
      target: targetAlias,
    })
    const rootAliasValue = sql.rootAlias
    const rowAlias = record ? sql.relationshipAlias : sql.targetAlias ?? rootAliasValue
    if (rowAlias === undefined) {
      throw new Error(`Graph: collection "${collection.name}" has no row alias`)
    }
    const relationship = 'relationship' in collection ? collection.relationship : undefined
    const resolver = this.#policyResolver(
      target,
      quoteIdentifier(rowAlias),
      quoteIdentifier(record ? rowAlias : rootAliasValue as string),
      true,
      nextPolicyFieldAlias,
    )
    const recordIdentities = record
      ? new Set(collection.relationship.between.map(endpoint => endpoint.field))
      : new Set<string>()
    const expressions = new Map<string, string>()
    const identities = new Set<string>()
    const resolve = (path: string): QueryFieldDefinition => {
      const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
      const member = resolveCollectionMember(collection, target, normalized, {
        resolve: value => this.#policyEntity(value),
      })
      if ('kind' in member) {
        if (relationship !== undefined && normalized.startsWith(`${lowerFirst(relationship.name)}.`)) {
          throw new Error(`Graph: unknown relationship field "${normalized}"`)
        }
        throw new Error(`Graph: unknown collection field "${target.name}.${normalized}"`)
      }
      if (member.relationshipProperty) {
        const property = normalized.slice(`${lowerFirst(relationship?.name ?? '')}.`.length)
        if (member.field.type === FieldType.Array || member.field.type === FieldType.JSON) {
          throw new Error(`Graph: relationship field "${normalized}" is not policy-safe`)
        }
        if (!sql.relationshipAlias) throw new Error(`Graph: unresolved relationship "${normalized}"`)
        const endpoint = relationship?.between.find(candidate => candidate.field === property)
        const column = endpoint === undefined ? property : `${endpoint.field}.id`
        expressions.set(
          normalized,
          `${quoteIdentifier(sql.relationshipAlias)}.${quoteIdentifier(column)}`,
        )
        return member.field
      }
      const result = resolver(normalized)
      expressions.set(result.field.name, result.expression)
      if (
        recordIdentities.has(normalized)
        || result.field.name.endsWith('.id')
        || normalized === 'id'
        || normalized.endsWith('.id')
      ) {
        identities.add(result.field.name)
      }
      return result.field
    }
    let nestedCollection: (nested: string) => CollectionScope | undefined = () => undefined
    if (!record) {
      nestedCollection = (nested: string) => this.#collectionSqlScope(
        target,
        nested,
        quoteIdentifier(sql.targetAlias ?? rowAlias),
        quoteIdentifier(sql.targetAlias ?? rowAlias),
        quoteIdentifier(rootAliasValue as string),
        true,
        nextPolicyFieldAlias,
        depth + 1,
      )
    }
    return {
      array: nested => {
        try {
          const result = resolver(nested)
          if (result.field.type !== FieldType.Array) return undefined
          return {
            expression: result.expression,
            field: result.field,
            member: {
              ...(result.field.items.format ? { format: result.field.items.format } : {}),
              name: result.field.name,
              type: result.field.items.type,
            },
          }
        } catch {
          return undefined
        }
      },
      collection: nestedCollection,
      condition: sql.condition,
      definition: target,
      expression: field => {
        const expression = expressions.get(field.name)
        if (!expression) throw new Error(`Graph: unresolved collection field "${field.name}"`)
        return expression
      },
      field: resolve,
      filterKind: path => (identities.has(path) ? 'identity' : undefined),
      predicate: sql.predicate,
      relation: sql.relation,
    }
  }

  #createHelperFunctions(): PhysicalFunction[] {
    const helpers: PhysicalFunction[] = []
    for (const leaf of this.definitions.concreteDescendants('Entity')) {
      const helper = this.#createHelper(leaf.name)
      if (helper) helpers.push(helper)
    }
    return helpers
  }

  #createHelper(leaf: string): PhysicalFunction | null {
    const entity = this.#policyEntity(leaf)
    if (!entity) return null
    const virtual = this.#virtualEntity(entity)
    const create = this.#createConditions(leaf, virtual, Action.Create)
    const read = this.#createConditions(leaf, virtual, Action.Read)
    if (create.length === 0 || read.length === 0) return null
    const name = this.#createHelperName(leaf)
    const qualified = this.#qualified(name)
    const fields = entity.effectiveFields.map(field => {
      const column = field.type === FieldType.Entity ? field.column : field.name
      const key = literal(column)
      const type = this.#policyType(field)
      let value: string
      if (field.owner !== leaf) {
        value = `(SELECT ${quoteIdentifier(column)} FROM ${quoteIdentifier(field.owner)} ` +
          `WHERE ${quoteIdentifier('id')} = root_id)`
      } else if (field.type === FieldType.Array) {
        const element = postgresScalarType(field.items.type)
        value = `CASE WHEN proposed ? ${key} THEN ` +
          `CASE WHEN jsonb_typeof(proposed->${key}) = 'null' THEN NULL ELSE ` +
          `ARRAY(SELECT jsonb_array_elements_text(proposed->${key})::${element}) END ` +
          'ELSE NULL END'
      } else if (field.type === FieldType.JSON) {
        value = `CASE WHEN proposed ? ${key} THEN (proposed->${key})::jsonb ELSE NULL END`
      } else {
        value = `CASE WHEN proposed ? ${key} THEN (proposed->>${key})::${type} ELSE NULL END`
      }
      return `${value} AS ${quoteIdentifier(column)}`
    })
    const body = `
      SELECT EXISTS (
        SELECT 1
        FROM (
          SELECT
            ${fields.join(', ')}
        ) "__row"
        WHERE ((${read.join(' OR ')}) AND (${create.join(' OR ')}))
      )
    `
    const generated = securityDefinerFunction({
      body: body.trim(),
      qualified,
      searchPath: this.#searchPath(),
      signature: 'root_id text, proposed jsonb',
    })
    return {
      body: generated.body,
      lifecycle: false,
      name,
      required: [name],
      searchPath: this.#searchPath(),
      securityDefiner: true,
      signature: 'root_id text, proposed jsonb',
      sql: generated.sql,
    }
  }

  #createPolicyExpression(leaf: string, alias: string): string | null {
    if (!this.#createHelper(leaf)) return null
    return `${this.#qualified(this.#createHelperName(leaf))}(${alias}.${quoteIdentifier('id')}, to_jsonb(${alias}.*))`
  }

  #createHelperName(leaf: string): string {
    return `policy_create_${createHash('sha256').update(leaf).digest('hex').slice(0, 16)}`
  }

  #virtualEntity(entity: EntityDefinition): EntityDefinition {
    return {
      ...entity,
      effectiveFields: entity.effectiveFields.map(field => ({ ...field, owner: entity.name })),
    }
  }

  #createConditions(leaf: string, virtual: EntityDefinition, action: Action): string[] {
    const targets = new Set(this.#ancestry(leaf))
    const conditions: string[] = []
    for (const grant of this.grants) {
      if (!targets.has(grant.target)) continue
      const actionMatches = grant.action === action
        || (MANAGED_ENTITIES.has(leaf) && grant.action === Action.Manage)
      if (!actionMatches) continue
      const predicate = grant.predicate
        ? this.#compileDirectPredicate(grant, '__row', leaf, true, virtual)
        : 'TRUE'
      conditions.push(`(${roleCondition(grant.role, this.#schema)} AND ${predicate})`)
    }
    return conditions
  }

  #policyType(field: EffectiveFieldDefinition): string {
    if (field.type === FieldType.Entity) return 'text'
    if (field.type === FieldType.Array) return `${postgresScalarType(field.items.type)}[]`
    if (field.type === FieldType.JSON) return 'jsonb'
    if (field.type === FieldType.Enum) return 'text'
    return postgresScalarType(field.type)
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
        ? this.#grantExpression(leaf, action, row, true, 'Entity')
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
        const expression = action === Action.Create
          ? this.#createPolicyExpression(leaf, alias)
          : this.#leafExpression(leaf, action, alias, false)
        if (expression) conditions.push(expression)
        continue
      }
      const childAlias = `__leaf_${conditions.length}`
      const predicate = action === Action.Create
        ? this.#grantExpression(leaf, action, alias, true, table)
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

  #grantExpression(
    leaf: string,
    action: Action,
    alias: string,
    roleOnly: boolean,
    table: string,
  ): string | null {
    const createTarget = action === Action.Create ? table : undefined
    const conditions = this.#actionConditions(leaf, action, alias, roleOnly, table, false, createTarget)
    if (conditions.length === 0) return null
    if (action === Action.Read || roleOnly) return `(${conditions.join(' OR ')})`
    if (action !== Action.Create && action !== Action.Update && action !== Action.Delete) {
      return `(${conditions.join(' OR ')})`
    }
    const readable = action === Action.Create
      ? this.#actionConditions(leaf, Action.Read, alias, false, table, true, createTarget)
      : this.#actionConditions(leaf, Action.Read, alias, false, table)
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
   * @param direct - Whether to bypass helper functions for proposed-row compilation.
   * @param createTarget - Physical table that owns the create rule, when creating.
   * @returns Matching rule expressions.
   */
  #actionConditions(
    leaf: string,
    action: Action,
    alias: string,
    roleOnly: boolean,
    table: string,
    direct = false,
    createTarget?: string,
  ): string[] {
    const targets = new Set([...this.#ancestry(leaf)])
    const conditions: string[] = []
    for (const grant of this.grants) {
      if (!targets.has(grant.target)) continue
      const actionMatches = grant.action === action
        || (MANAGED_ENTITIES.has(leaf) && grant.action === Action.Manage)
      if (!actionMatches) continue
      const role = roleCondition(grant.role, this.#schema)
      let predicate = 'TRUE'
      if (!roleOnly && grant.predicate && createTarget !== undefined && grant.target !== createTarget) {
        predicate = 'TRUE'
      } else if (!roleOnly && grant.predicate) {
        predicate = direct
          ? this.#compileDirectPredicate(grant, alias, table, true)
          : this.#compilePredicate(grant, alias, table, action)
      }
      conditions.push(`(${role} AND ${predicate})`)
    }
    return conditions
  }

  #compilePredicate(grant: GraphGrant, alias: string, table: string, action: Action): string {
    if (action === Action.Create) {
      return this.#compileDirectPredicate(grant, alias, table, true)
    }
    if (this.#requiresHelper(grant, table)) {
      const relationship = this.definitions.relationship(table)
      let args = `${alias}.${quoteIdentifier('id')}`
      if (relationship) {
        args = relationship.between
          .map(endpoint => `${alias}.${quoteIdentifier(`${endpoint.field}.id`)}`)
          .join(', ')
      }
      return `${this.#qualified(this.#helperName(grant))}(${args})`
    }
    return this.#compileDirectPredicate(grant, alias, table, false)
  }

  #grantApplies(grant: GraphGrant, leaf: string): boolean {
    return new Set(this.#ancestry(leaf)).has(grant.target)
  }

  #requiresHelper(grant: GraphGrant, table: string): boolean {
    if (grant.target !== table || !grant.predicate) return grant.target !== table
    const entity = grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target)
    if (!entity) return true
    return filterFieldNames(grant.predicate).some(name => {
      if (name === ACTOR_FIELD_NAME) return false
      if (name.endsWith('.id')) {
        const reference = entity.effectiveFields.find(
          candidate => candidate.name === name.slice(0, -'.id'.length),
        )
        if (reference?.owner === grant.target && reference.type === FieldType.Entity) return false
      }
      if (name.includes('.')) return true
      const field = entity.effectiveFields.find(candidate => candidate.name === name)
      return !field || field.owner !== grant.target
    })
  }

  #helperName(grant: GraphGrant): string {
    const hash = createHash('sha256')
      .update(JSON.stringify({ predicate: grant.predicate, target: grant.target }))
      .digest('hex')
      .slice(0, 16)
    return `policy_${hash}`
  }

  #compileDirectPredicate(
    grant: GraphGrant,
    alias: string,
    table: string,
    allowSubqueries: boolean,
    entityOverride?: EntityDefinition,
  ): string {
    const entity = entityOverride ??
      (grant.target === 'Entity' ? identityDefinition() : this.#policyEntity(grant.target))
    if (!entity) throw new Error(`Graph: unknown predicate target "${grant.target}"`)
    const rootAlias = entity.name === 'Entity' ? alias : undefined
    let policyFieldIndex = 0
    const nextAlias = (): string => {
      const name = policyFieldIndex === 0 ? '__policy_field' : `__policy_field_${policyFieldIndex}`
      policyFieldIndex += 1
      return name
    }
    const resolver = this.#policyResolver(entity, alias, rootAlias, allowSubqueries, nextAlias)
    const expressions = new Map<string, string>()
    const field = (name: string): QueryFieldDefinition => {
      const resolved = resolver(name)
      expressions.set(resolved.field.name, resolved.expression)
      return resolved.field
    }
    const scope: QueryScope = {
      array: name => {
        try {
          const resolved = resolver(name)
          if (resolved.field.type !== FieldType.Array) return undefined
          return {
            expression: resolved.expression,
            field: resolved.field,
            member: {
              ...(resolved.field.items.format ? { format: resolved.field.items.format } : {}),
              name: resolved.field.name,
              type: resolved.field.items.type,
            },
          }
        } catch {
          return undefined
        }
      },
      collection: name => this.#collectionSqlScope(entity, name, alias, alias, rootAlias, allowSubqueries, nextAlias),
      definition: entity,
      expression: value => {
        const expression = expressions.get(value.name)
        if (!expression) throw new Error(`Graph: unresolved policy field "${value.name}"`)
        return expression
      },
      field,
      filterField: field,
    }
    const where = SQL.whereFilter(this.definitions, entity.name, grant.predicate as Filter, scope)
    return `(${inline(where.sql.replace(/^WHERE\s+/u, ''), where.values)})`
  }

  #searchPath(): string {
    return this.#schema === 'public'
      ? 'public, basis, pg_temp'
      : `${this.#schema}, public, basis, pg_temp`
  }

  #qualified(name: string): string {
    return name.includes('.') ? name : `${this.#schema}.${name}`
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
      const qualified = this.#qualified(name)
      const predicate = this.#compileDirectPredicate(grant, '__row', grant.target, true)
      const relationship = this.definitions.relationship(grant.target)
      let signature = 'root_id text'
      let identity = `"__row".${quoteIdentifier('id')} = root_id`
      if (relationship) {
        signature = relationship.between
          .map(endpoint => `${endpoint.field}Id text`)
          .join(', ')
        identity = relationship.between
          .map(endpoint => `"__row".${quoteIdentifier(`${endpoint.field}.id`)} = ${endpoint.field}Id`)
          .join(' AND ')
      }
      const body = `
        SELECT EXISTS (
          SELECT 1
          FROM ${quoteIdentifier(grant.target)} AS "__row"
          WHERE ${identity}
            AND ${predicate}
        )
      `.trim()
      const generated = securityDefinerFunction({
        body,
        qualified,
        searchPath: this.#searchPath(),
        signature,
      })
      functions.push({
        body: generated.body,
        lifecycle: false,
        name,
        required: [name],
        searchPath: this.#searchPath(),
        securityDefiner: true,
        signature,
        sql: generated.sql,
      })
    }
    return functions
  }

  /**
   * Build one reviewed SECURITY DEFINER Boolean helper per entity validation constraint.
   *
   * The helper evaluates the canonical constraint predicate against the final
   * row inside the caller's native transaction, independently of the writer's
   * current READ visibility. It returns only a Boolean and never row content.
   * Write provenance is taken from the canonical `Entity` root tuple that every
   * Graph-native create/edit/upsert touches, so an inherited-field or child-field
   * edit still validates without manufacturing writes to constraint-owner tables.
   * Ordinary app-role SQL cannot use the helper as an oracle for rows this
   * transaction did not write. Relationship constraints are skipped because no
   * Graph-native edge-write boundary exists.
   * @returns Validation helper functions.
   */
  #validationFunctions(): PhysicalFunction[] {
    const functions: PhysicalFunction[] = []
    for (const constraint of this.definitions.constraints) {
      if (constraint.type !== Constraint.Validation || !constraint.validator) continue
      const owner = this.definitions.entity(constraint.owner)
      if (!owner) continue
      const grant: GraphGrant = {
        action: Action.Read,
        predicate: constraint.where,
        role: PUBLIC_ROLE_ID,
        target: constraint.owner,
      }
      const predicate = this.#compileDirectPredicate(grant, '__row', constraint.owner, true)
      const name = constraint.validator.replace(/^basis\./u, '')
      const qualified = this.#qualified(name)
      const body = `
        SELECT EXISTS (
          SELECT 1
          FROM ${quoteIdentifier(constraint.owner)} AS "__row"
          JOIN "Entity" AS "__written"
            ON "__written".${quoteIdentifier('id')} = "__row".${quoteIdentifier('id')}
          WHERE "__row".${quoteIdentifier('id')} = root_id
            AND (
              "__written".xmin = pg_current_xact_id()::xid
              OR pg_xact_status("__written".xmin::text::xid8) = 'in progress'
            )
            AND ${predicate}
        )
      `.trim()
      const generated = securityDefinerFunction({
        body,
        qualified,
        searchPath: this.#searchPath(),
        signature: 'root_id text',
      })
      functions.push({
        body: generated.body,
        lifecycle: false,
        name,
        required: [name],
        searchPath: this.#searchPath(),
        securityDefiner: true,
        signature: 'root_id text',
        sql: generated.sql,
      })
    }
    return functions
  }

  #manageExpression(target: string): string | null {
    const targets = new Set([...this.#ancestry(target), target])
    const conditions = this.grants
      .filter(grant => grant.action === Action.Manage && targets.has(grant.target))
      .map(grant => roleCondition(grant.role, this.#schema))
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
      sql: `GRANT EXECUTE ON FUNCTION basis.has_role(text, text) TO ${role}`,
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
      sql: 'REVOKE ALL ON FUNCTION basis.has_role(text, text) FROM PUBLIC',
    })
    for (const fn of [
      ...this.#policyFunctions(),
      ...this.#validationFunctions(),
      ...this.#createHelperFunctions(),
    ]) {
      const helperGrant = `grant:${appRole}:function:${fn.name}:EXECUTE`
      grants.push({
        function: fn.name,
        grantName: helperGrant,
        grantee: appRole,
        kind: 'grant',
        name: helperGrant,
        object: 'function',
        privilege: 'EXECUTE',
        sql: `GRANT EXECUTE ON FUNCTION ${this.#qualified(fn.name)}(${fn.signature ?? 'text'}) TO ${role}`,
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
        sql: `REVOKE ALL ON FUNCTION ${this.#qualified(fn.name)}(${fn.signature ?? 'text'}) FROM PUBLIC`,
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
 * Lowercase only the first character of a relationship name.
 * @param value - Relationship name.
 * @returns Its nested member-property prefix.
 */
function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`
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
 */
function assertPolicySafe(filter: Filter): void {
  if ('filters' in filter) {
    if (isUniversalCollectionFilter(filter)) {
      throw new Error('Graph: $all collection policy predicates are not supported')
    }
    if ('field' in filter) {
      if (filter.operator === Operator.Collection.All) {
        throw new Error('Graph: $all collection policy predicates are not supported')
      }
      if (filter.operator !== Operator.Comparison.Contains
        && filter.operator !== Operator.Comparison.Empty) {
        throw new Error(`Graph: collection operator "${filter.operator}" is not policy-safe`)
      }
      if (filter.operator === Operator.Comparison.Contains) {
        if (filter.filters.length === 0) {
          throw new Error('Graph: collection $contains requires at least one member requirement')
        }
      } else if (filter.filters.length !== 0) {
        throw new Error('Graph: collection $empty cannot carry member requirements')
      }
      for (const child of filter.filters) assertPolicySafe(child)
      return
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
 * @param schema - Target Graph schema.
 * @returns SQL boolean expression.
 */
function roleCondition(role: string, schema: string): string {
  if (role === PUBLIC_ROLE_ID) return 'TRUE'
  return `basis.has_role(${literal(schema)}, ${literal(role)})`
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
 * Build one SECURITY DEFINER SQL function with a body-safe dollar delimiter.
 * @param options - Function name, signature, search path and body.
 * @param options.body - Complete SQL function body.
 * @param options.qualified - Schema-qualified function name.
 * @param options.searchPath - Function search path.
 * @param options.signature - Function argument signature.
 * @returns The function body and DDL.
 */
function securityDefinerFunction(options: {
  readonly body: string,
  readonly qualified: string,
  readonly searchPath: string,
  readonly signature: string,
}): { readonly body: string, readonly sql: string } {
  const delimiter = dollarDelimiter(options.body)
  return {
    body: options.body,
    sql: `
      CREATE OR REPLACE FUNCTION ${options.qualified}(${options.signature})
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${options.searchPath} AS ${delimiter}
        ${options.body}
      ${delimiter};
    `,
  }
}

/**
 * Choose a dollar-quote delimiter absent from one function body.
 * @param body - Complete SQL function body.
 * @returns A delimiter that does not occur in the body.
 */
function dollarDelimiter(body: string): string {
  let index = 0
  let delimiter = '$basis$'
  while (body.includes(delimiter)) {
    delimiter = `$basis_${index}$`
    index += 1
  }
  return delimiter
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
