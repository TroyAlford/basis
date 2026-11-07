import type { SQL as BunSQL } from 'bun'
import { createHash } from 'node:crypto'

/** The category of one physical schema object. */
export type PhysicalKind =
  | 'constraint' | 'extension' | 'function' | 'grant' | 'index' | 'policy'
  | 'role' | 'row-security' | 'schema' | 'table' | 'trigger'

/** One typed physical column. */
export interface PhysicalColumn {
  /** Column default expression, when present. */
  readonly default?: string | null,
  /** Stable column name. */
  readonly name: string,
  /** Whether the column accepts NULL. */
  readonly nullable: boolean,
  /** Whether this column is the table's primary key. */
  readonly primaryKey: boolean,
  /** Physical SQL type. */
  readonly sqlType: string,
}

/** One typed physical index. */
export interface PhysicalIndex {
  /** Indexed columns, when compiled from the canonical model. */
  readonly columns?: readonly string[],
  /** Complete catalog definition, when introspected. */
  readonly definition?: string,
  /** Index name. */
  readonly name: string,
  /** Complete create-index SQL when compiled from a desired model. */
  readonly sql: string,
  /** Owning table name. */
  readonly table: string,
  /** Whether the index is unique. */
  readonly unique?: boolean,
  /** Whether the catalog index is valid. */
  readonly valid?: boolean,
}

/** One typed physical constraint. */
export interface PhysicalConstraint {
  /** FK local column, when this is a foreign key. */
  readonly column?: string,
  /** Complete catalog definition, when introspected. */
  readonly definition?: string,
  /** Constraint name. */
  readonly name: string,
  /** Complete add-constraint SQL. */
  readonly sql: string,
  /** Owning table name. */
  readonly table: string,
  /** FK target table, when this is a foreign key. */
  readonly target?: string,
  /** FK target column, when this is a foreign key. */
  readonly targetColumn?: string,
}

/** One typed physical table. */
export interface PhysicalTable {
  /** Typed columns. */
  readonly columns: readonly PhysicalColumn[],
  /** Whether RLS is forced for this table. */
  readonly forceRowSecurity?: boolean,
  /** Indexes owned by the table. */
  readonly indexes: readonly PhysicalIndex[],
  /** Table name, qualified with `basis.` for internal tables. */
  readonly name: string,
  /** Primary-key columns. */
  readonly primaryKey: readonly string[],
  /** Whether RLS is enabled for this table. */
  readonly rowSecurity?: boolean,
  /** Complete create-table SQL. */
  readonly sql: string,
}

/** One typed function or function group. */
export interface PhysicalFunction {
  /** Lifecycle function body for definition reconciliation. */
  readonly body?: string,
  /** Complete catalog definition, when introspected. */
  readonly definition?: string,
  /** Whether this is a lifecycle function. */
  readonly lifecycle?: boolean,
  /** Stable object name. */
  readonly name: string,
  /** Required PostgreSQL function names for this compiled object. */
  readonly required: readonly string[],
  /** Function search_path setting. */
  readonly searchPath?: string,
  /** Whether the function is security definer. */
  readonly securityDefiner?: boolean,
  /** Function identity argument signature. */
  readonly signature?: string,
  /** Complete function DDL. */
  readonly sql: string,
}

/** One typed trigger. */
export interface PhysicalTrigger {
  /** Trigger columns, when declared. */
  readonly columns?: readonly string[],
  /** Whether this is a constraint trigger. */
  readonly constraint?: boolean,
  /** Whether this is deferrable. */
  readonly deferrable?: boolean,
  /** Complete catalog definition, when introspected. */
  readonly definition?: string,
  /** Whether the trigger is enabled. */
  readonly enabled?: string,
  /** Trigger function name. */
  readonly functionName?: string,
  /** Whether initially deferred. */
  readonly initDeferred?: boolean,
  /** Trigger name. */
  readonly name: string,
  /** Complete create-trigger SQL. */
  readonly sql: string,
  /** Owning table. */
  readonly table: string,
  /** PostgreSQL trigger type bitmask. */
  readonly type?: number,
}

/** One typed row-level policy. */
export interface PhysicalPolicy {
  /** SQL command the policy applies to. */
  readonly command?: string,
  /** Policy definition, when introspected. */
  readonly definition?: string,
  /** Policy name. */
  readonly name: string,
  /** Whether the policy is permissive or restrictive. */
  readonly permissive?: string,
  /** Roles the policy applies to. */
  readonly roles?: readonly string[],
  /** Complete create-policy SQL. */
  readonly sql: string,
  /** Owning table. */
  readonly table: string,
}

/** One typed physical grant or revoke statement. */
export interface PhysicalGrant {
  /** Function name for function grants. */
  readonly function?: string,
  /** Grant name used for lookup; revoke entries point at this grant. */
  readonly grantName?: string,
  /** Grantee role name. */
  readonly grantee?: string,
  /** Whether this is a grant or a revoke statement. */
  readonly kind?: 'grant' | 'revoke',
  /** Stable object name. */
  readonly name: string,
  /** Object family. */
  readonly object?: 'function' | 'schema' | 'table',
  /** Privilege name. */
  readonly privilege?: string,
  /** Complete grant or revoke SQL. */
  readonly sql: string,
  /** Optional schema or table target. */
  readonly table?: string,
}

/** One graph-managed role row. */
export interface PhysicalRole {
  /** Optional role description. */
  readonly description?: string,
  /** Stable canonical UUID identity. */
  readonly id: string,
  /** Mutable human-readable role name. */
  readonly name: string,
}

/** One typed physical schema snapshot. */
export interface PhysicalSchema {
  /** Constraints. */
  readonly constraints: readonly PhysicalConstraint[],
  /** Installed extensions. */
  readonly extensions: readonly string[],
  /** Functions and function groups. */
  readonly functions: readonly PhysicalFunction[],
  /** Authorization grants and revokes. */
  readonly grants?: readonly PhysicalGrant[],
  /** Policies. */
  readonly policies: readonly PhysicalPolicy[],
  /** Graph-managed role rows. */
  readonly roles?: readonly PhysicalRole[],
  /** Installed schemas. */
  readonly schemas?: readonly string[],
  /** Tables. */
  readonly tables: readonly PhysicalTable[],
  /** Triggers. */
  readonly triggers: readonly PhysicalTrigger[],
}

/** One deterministic schema operation. */
export interface SchemaOperation {
  /** Objects this operation requires first. */
  dependsOn: readonly string[],
  /** Stable operation id. */
  readonly id: string,
  /** Operation category. */
  readonly kind: PhysicalKind | 'add-column' | 'alter-column' | 'drop-column',
  /** Intentional preconditions. */
  readonly preconditions?: readonly string[],
  /** Risk classification. */
  readonly risk: 'data' | 'review' | 'safe',
  /** Intended SQL. */
  readonly sql: string,
  /** Object identifier. */
  readonly target: string,
}

/** One schema planning result. */
export interface SchemaPlan {
  /** Unresolved rename candidates. */
  readonly ambiguities: readonly string[],
  /** Whether destructive or ambiguous drift blocks execution. */
  readonly blocked: boolean,
  /** Drift found in the live catalog. */
  readonly drift: readonly string[],
  /** Deterministic operation graph. */
  readonly operations: readonly SchemaOperation[],
}

/** One canonical model that compiles to a physical schema. */
export interface PhysicalModel {
  /**
   * Compile the model's typed physical representation.
   * @param appRole - Restricted application role.
   * @param superuser - Whether provisioning can force owner RLS.
   * @param includeAuthorization - Whether security objects are requested.
   * @returns The physical schema.
   */
  physicalSchema(
    appRole?: string,
    superuser?: boolean,
    includeAuthorization?: boolean,
  ): PhysicalSchema,
}

/** Planning inputs. */
export interface PlanOptions {
  /** Live catalog snapshot. */
  readonly actual: PhysicalSchema,
  /** Restricted app role used by security DDL. */
  readonly appRole?: string,
  /** Desired canonical model. */
  readonly desired: PhysicalModel,
  /** Retained compatibility flag; graph models compile their security objects. */
  readonly includeAuthorization?: boolean,
  /** Previous deployed model, when available. */
  readonly previous?: PhysicalModel,
  /** Whether the provisioning connection can force owner RLS. */
  readonly superuser?: boolean,
}

/** Order operations from prerequisites to dependants. */
const PHASE: Readonly<Record<string, number>> = {
  'add-column': 3,
  'alter-column': 3,
  'constraint': 5,
  'drop-column': 3,
  'extension': 0,
  'function': 6,
  'grant': 8,
  'index': 4,
  'policy': 7,
  'role': 9,
  'row-security': 7,
  'schema': 1,
  'table': 2,
  'trigger': 6,
}

/**
 * Introspect the live PostgreSQL schema without mutating it.
 * @param sql - Connected SQL client.
 * @returns The current physical schema.
 */
export async function introspect(sql: BunSQL): Promise<PhysicalSchema> {
  const extensions = await sql<{ name: string }[]>`
    SELECT extname AS name
    FROM pg_extension
    WHERE extname NOT IN ('plpgsql')
    ORDER BY extname
  `
  const schemaRows = await sql<{ name: string }[]>`
    SELECT nspname AS name
    FROM pg_namespace
    WHERE nspname IN ('public', 'basis', current_schema())
    ORDER BY nspname
  `
  const tableRows = await sql<{
    force: boolean,
    rowSecurity: boolean,
    schema: string,
    table: string,
  }[]>`
    SELECT n.nspname AS schema,
      c.relname AS TABLE,
      c.relrowsecurity AS "rowSecurity",
      c.relforcerowsecurity AS force
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN (current_schema(), 'basis')
    ORDER BY n.nspname, c.relname
  `
  const columnRows = await sql<{
    column: string,
    default: string | null,
    nullable: string,
    schema: string,
    table: string,
    type: string,
  }[]>`
    SELECT table_schema AS schema,
      table_name AS TABLE,
      column_name AS column,
      is_nullable AS nullable,
      column_default AS default,
      data_type AS type
    FROM information_schema.columns
    WHERE table_schema IN (current_schema(), 'basis')
    ORDER BY table_schema, table_name, ordinal_position
  `
  const indexRows = await sql<{
    columns: string[] | null,
    definition: string,
    index: string,
    schema: string,
    table: string,
    unique: boolean,
    valid: boolean,
  }[]>`
    SELECT n.nspname AS schema,
      t.relname AS TABLE,
      c.relname AS INDEX,
      i.indisunique AS UNIQUE,
      i.indisvalid AS valid,
      pg_get_indexdef(i.indexrelid) AS definition,
(SELECT array_agg(a.attname ORDER BY u.ordinality) FROM unnest(i.indkey) WITH ORDINALITY u(attnum,
      ordinality) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = u.attnum) AS columns
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN (current_schema(), 'basis') AND NOT i.indisprimary
    ORDER BY n.nspname, t.relname, c.relname
  `
  const constraintRows = await sql<{
    constraint: string,
    definition: string,
    schema: string,
    table: string,
  }[]>`
    SELECT n.nspname AS schema,
      c.relname AS TABLE,
      con.conname AS CONSTRAINT,
      pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN (current_schema(), 'basis') AND con.contype = 'f'
    ORDER BY n.nspname, c.relname, con.conname
  `
  const primaryRows = await sql<{
    columns: string[],
    schema: string,
    table: string,
  }[]>`
    SELECT n.nspname AS schema,
      c.relname AS TABLE,
      array_agg(a.attname ORDER BY u.ordinality) AS columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey)
    WITH ORDINALITY u(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.attnum
    WHERE con.contype = 'p' AND n.nspname IN (current_schema(), 'basis')
    GROUP BY n.nspname, c.relname
    ORDER BY n.nspname, c.relname
  `
  const primaryByTable = new Map<string, string[]>()
  for (const row of primaryRows) {
    const name = `${row.schema === 'basis' ? 'basis.' : ''}${row.table}`
    primaryByTable.set(name, row.columns)
  }

  const functionRows = await sql<{
    body: string,
    definition: string,
    name: string,
    searchPath: string | null,
    securityDefiner: boolean,
    signature: string,
  }[]>`
    SELECT CASE WHEN n.nspname = 'basis' THEN 'basis.' || p.proname ELSE p.proname END AS name,
      p.prosrc AS body,
      pg_get_functiondef(p.oid) AS definition,
      p.prosecdef AS "securityDefiner",
      pg_get_function_identity_arguments(p.oid) AS signature,
      array_to_string(p.proconfig,
      ',') AS "searchPath"
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN (current_schema(), 'basis')
    ORDER BY n.nspname, p.proname
  `
  const triggerRows = await sql<{
    columns: string[] | null,
    constraint: number,
    deferrable: boolean,
    enabled: string,
    functionName: string,
    initDeferred: boolean,
    name: string,
    table: string,
    type: number,
  }[]>`
    SELECT n.nspname AS schema,
      c.relname AS TABLE,
      t.tgname AS name,
      t.tgenabled AS enabled,
      t.tgtype AS type,
      t.tgdeferrable AS DEFERRABLE,
      t.tginitdeferred AS "initDeferred",
      t.tgconstraint AS CONSTRAINT,
      p.proname AS "functionName",
(SELECT array_agg(a.attname ORDER BY u.ordinality) FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY
  u(attnum,
      ordinality) JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = u.attnum) AS columns
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname IN (current_schema(), 'basis')
    ORDER BY n.nspname, c.relname, t.tgname
  `
  const policyRows = await sql<{
    command: string,
    definition: string,
    name: string,
    permissive: string,
    roles: string[],
    schema: string,
    table: string,
  }[]>`
    SELECT schemaname AS schema,
      tablename AS TABLE,
      policyname AS name,
      cmd AS command,
      permissive,
      roles,
      concat('USING ',
      coalesce(qual,
      'true'),
      ' WITH CHECK ',
      coalesce(with_check,
      'true')) AS definition
    FROM pg_policies
    WHERE schemaname IN (current_schema(), 'basis')
    ORDER BY schemaname, tablename, policyname
  `

  const grantRows = await sql<{
    grantee: string,
    privilege: string,
    schema: string,
    table: string,
  }[]>`
    SELECT grantee, table_schema AS schema, table_name AS TABLE, privilege_type AS privilege
    FROM information_schema.role_table_grants
    WHERE table_schema IN (current_schema(), 'basis')
    ORDER BY grantee, table_schema, table_name, privilege_type
  `
  const grants: PhysicalGrant[] = grantRows.map(row => {
    const table = row.schema === 'basis' ? `basis.${row.table}` : row.table
    return {
      grantee: row.grantee,
      kind: 'grant' as const,
      name: `grant:${row.grantee}:table:${table}:${row.privilege}`,
      object: 'table' as const,
      privilege: row.privilege,
      sql: '',
      table,
    }
  })

  const schemaGrantRows = await sql<{
    grantee: string,
    privilege: string,
    schema: string,
  }[]>`
    SELECT n.nspname AS schema,
      CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
      a.privilege_type AS privilege
    FROM pg_namespace n, aclexplode(n.nspacl) a
    WHERE n.nspname IN ('public', 'basis', current_schema())
    ORDER BY n.nspname, grantee, privilege
  `
  const functionGrantRows = await sql<{
    function: string,
    grantee: string,
    privilege: string,
  }[]>`
    SELECT CASE WHEN n.nspname = 'basis' THEN 'basis.' || p.proname ELSE p.proname END AS function,
      CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
      a.privilege_type AS privilege
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(p.proacl) a
    WHERE n.nspname IN (current_schema(), 'basis')
    ORDER BY function, grantee, privilege
  `
  for (const row of schemaGrantRows) {
    grants.push({
      grantee: row.grantee,
      kind: 'grant',
      name: `grant:${row.grantee}:schema:${row.schema}:${row.privilege}`,
      object: 'schema',
      privilege: row.privilege,
      sql: '',
      table: row.schema,
    })
  }
  for (const row of functionGrantRows) {
    grants.push({
      function: row.function,
      grantee: row.grantee,
      kind: 'grant',
      name: `grant:${row.grantee}:function:${row.function}:${row.privilege}`,
      object: 'function',
      privilege: row.privilege,
      sql: '',
    })
  }
  const defaultFunctionRows = await sql<{ function: string }[]>`
    SELECT CASE WHEN n.nspname = 'basis' THEN 'basis.' || p.proname ELSE p.proname END AS function
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN (current_schema(), 'basis') AND p.proacl IS NULL
  `
  for (const row of defaultFunctionRows) {
    grants.push({
      function: row.function,
      grantee: 'PUBLIC',
      kind: 'grant',
      name: `grant:PUBLIC:function:${row.function}:EXECUTE`,
      object: 'function',
      privilege: 'EXECUTE',
      sql: '',
    })
  }

  const columnsByTable = new Map<string, PhysicalColumn[]>()
  for (const row of columnRows) {
    const name = `${row.schema === 'basis' ? 'basis.' : ''}${row.table}`
    const columns = columnsByTable.get(name) ?? []
    columns.push({
      default: row.default,
      name: row.column,
      nullable: row.nullable === 'YES',
      primaryKey: false,
      sqlType: row.type,
    })
    columnsByTable.set(name, columns)
  }
  const indexesByTable = new Map<string, PhysicalIndex[]>()
  for (const row of indexRows) {
    const name = `${row.schema === 'basis' ? 'basis.' : ''}${row.table}`
    const indexes = indexesByTable.get(name) ?? []
    indexes.push({
      columns: row.columns ?? [],
      definition: row.definition,
      name: row.index,
      sql: row.definition,
      table: name,
      unique: row.unique,
      valid: row.valid,
    })
    indexesByTable.set(name, indexes)
  }
  const tables: PhysicalTable[] = tableRows.map(row => {
    const name = `${row.schema === 'basis' ? 'basis.' : ''}${row.table}`
    return {
      columns: columnsByTable.get(name) ?? [],
      forceRowSecurity: row.force,
      indexes: indexesByTable.get(name) ?? [],
      name,
      primaryKey: primaryByTable.get(name) ?? [],
      rowSecurity: row.rowSecurity,
      sql: '',
    }
  })
  let roles: PhysicalRole[] = []
  const [roleTable] = await sql<{ present: boolean }[]>`
    SELECT to_regclass('"Role"') IS NOT NULL AS present
  `
  if (roleTable?.present) {
    roles = await sql<{ description: string, id: string, name: string }[]>`
      SELECT r."id", e."name", r."description"
      FROM "Role" r
      JOIN "Entity" e ON e."id" = r."id"
      ORDER BY r."id"
    `
  }

  return {
    constraints: constraintRows.map(row => ({
      definition: row.definition,
      name: row.constraint,
      sql: `ALTER TABLE ${quote(row.schema === 'basis' ? `basis.${row.table}` : row.table)} ` +
        `ADD CONSTRAINT ${quote(row.constraint)} ${row.definition}`,
      table: row.schema === 'basis' ? `basis.${row.table}` : row.table,
    })),
    extensions: extensions.map(row => row.name),
    functions: functionRows.map(row => ({
      body: row.body,
      definition: row.definition,
      name: row.name,
      required: [row.name],
      searchPath: row.searchPath ?? undefined,
      securityDefiner: row.securityDefiner,
      signature: row.signature,
      sql: '',
    })),
    grants,
    policies: policyRows.map(row => ({
      command: row.command,
      definition: row.definition,
      name: row.name,
      permissive: row.permissive,
      roles: row.roles,
      sql: '',
      table: row.schema === 'basis' ? `basis.${row.table}` : row.table,
    })),
    roles,
    schemas: schemaRows.map(row => row.name),
    tables,
    triggers: triggerRows.map(row => ({
      columns: row.columns ?? [],
      constraint: row.constraint !== 0,
      deferrable: row.deferrable,
      definition: '',
      enabled: row.enabled,
      functionName: row.functionName,
      initDeferred: row.initDeferred,
      name: row.name,
      sql: '',
      table: row.table,
      type: row.type,
    })),
  }
}

/**
 * Set required function names from a desired physical schema.
 * @param schema - Desired schema.
 * @returns Required names.
 */
function desiredFunctionNamesForPlan(schema: PhysicalSchema): Set<string> {
  return new Set(schema.functions.flatMap(fn => fn.required))
}

/**
 * Plan a non-mutating schema transition from the live catalog to a desired model.
 * @param options - Previous and desired definitions plus the live catalog.
 * @returns The deterministic plan.
 */
export function plan(options: PlanOptions): SchemaPlan {
  const desired = options.desired.physicalSchema(options.appRole, options.superuser)
  const previous = options.previous?.physicalSchema(options.appRole, options.superuser)
  const actualTables = new Map(options.actual.tables.map(table => [table.name, table]))
  const desiredTables = new Map(desired.tables.map(table => [table.name, table]))
  const previousTablesPhysical = new Map(previous?.tables.map(table => [table.name, table]) ?? [])
  const removedTables = new Set([...previousTablesPhysical.keys()].filter(name => !desiredTables.has(name)))
  const actualFunctions = new Set(options.actual.functions.flatMap(fn => fn.required))
  const actualTriggers = new Set(options.actual.triggers.map(trigger => trigger.name))
  const actualPolicies = new Set(options.actual.policies.map(policy => policy.name))
  const actualExtensions = new Set(options.actual.extensions)
  const previousTriggers = new Set(previous?.triggers.map(trigger => trigger.name) ?? [])
  const previousFunctions = new Set(previous?.functions.flatMap(fn => fn.required) ?? [])
  const previousConstraints = new Set(previous?.constraints.map(constraint => constraint.name) ?? [])
  const previousPolicies = new Set(previous?.policies.map(policy => policy.name) ?? [])
  const previousFunctionMap = new Map(previous?.functions.map(fn => [fn.name, fn]) ?? [])
  const previousGrantNames = new Set((previous?.grants ?? [])
    .filter(grant => grant.kind !== 'revoke')
    .map(grant => grant.name))
  const operations: SchemaOperation[] = []
  const drift: string[] = []
  const ambiguities: string[] = []

  const desiredExtensions = new Set(desired.extensions)
  for (const extension of desired.extensions) {
    if (!actualExtensions.has(extension)) {
      operations.push({
        dependsOn: [],
        id: `extension:${extension}`,
        kind: 'extension',
        risk: 'safe',
        sql: `CREATE EXTENSION IF NOT EXISTS ${quote(extension)}`,
        target: extension,
      })
    }
  }
  for (const extension of actualExtensions) {
    if (!desiredExtensions.has(extension)) drift.push(`unexpected extension: ${extension}`)
  }
  const actualSchemas = new Set(options.actual.schemas ?? [])
  for (const schema of desired.schemas ?? []) {
    if (!actualSchemas.has(schema)) {
      operations.push({
        dependsOn: [],
        id: `schema:${schema}`,
        kind: 'schema',
        risk: 'safe',
        sql: `CREATE SCHEMA IF NOT EXISTS ${quote(schema)}`,
        target: schema,
      })
    }
  }

  const actualGrants = new Map((options.actual.grants ?? []).map(grant => [grant.name, grant]))
  const desiredGrants = new Set((desired.grants ?? []).map(grant => grant.name))
  const desiredRevokes = new Set((desired.grants ?? [])
    .filter(grant => grant.kind === 'revoke')
    .map(grant => grant.grantName)
    .filter((name): name is string => Boolean(name)))
  const desiredGrantees = new Set((desired.grants ?? [])
    .map(grant => grant.grantee)
    .filter((grantee): grantee is string => Boolean(grantee) && grantee !== 'PUBLIC'))
  const desiredFunctionNamesForGrants = new Set(desired.functions.flatMap(fn => fn.required))
  const removedFunctionNames = new Set([...previousFunctions]
    .filter(name => !desiredFunctionNamesForGrants.has(name)))
  for (const grant of desired.grants ?? []) {
    const missingFunction = grant.object === 'function' && grant.function !== undefined
      && desiredFunctionNamesForGrants.has(grant.function) && !actualFunctions.has(grant.function)
    const exists = grant.kind === 'revoke'
      ? Boolean((grant.grantName && actualGrants.has(grant.grantName)) || missingFunction)
      : actualGrants.has(grant.name)
    if (!exists && grant.kind !== 'revoke') {
      if (previousGrantNames.has(grant.name)) continue
      operations.push({
        dependsOn: [],
        id: `grant:${grant.name}`,
        kind: 'grant',
        risk: 'review',
        sql: grant.sql,
        target: grant.name,
      })
    } else if (exists && grant.kind === 'revoke') {
      operations.push({
        dependsOn: [],
        id: `grant:${grant.name}`,
        kind: 'grant',
        risk: 'review',
        sql: grant.sql,
        target: grant.name,
      })
    }
  }
  for (const grant of actualGrants.values()) {
    if (desiredGrants.has(grant.name) || desiredRevokes.has(grant.name)) continue
    if (grant.table && removedTables.has(grant.table)) continue
    if (grant.function && removedFunctionNames.has(grant.function)) continue
    if (grant.grantee && desiredGrantees.has(grant.grantee)) {
      drift.push(`unexpected grant: ${grant.name}`)
    }
  }

  const actualRoles = new Map((options.actual.roles ?? []).map(role => [role.id, role]))
  const previousRoles = new Map((previous?.roles ?? []).map(role => [role.id, role]))
  const desiredRoles = new Map((desired.roles ?? []).map(role => [role.id, role]))
  for (const [id, role] of previousRoles) {
    const actualRole = actualRoles.get(id)
    if (!actualRole) {
      drift.push(`missing deployed role: ${id}`)
    } else if (!sameRole(role, actualRole)) {
      drift.push(`out-of-band role definition change: ${id}`)
    }
  }
  for (const [id, role] of desiredRoles) {
    const actualRole = actualRoles.get(id)
    if (!actualRole) {
      if (previousRoles.has(id)) continue
      operations.push({
        dependsOn: ['table:Entity', 'table:Role'],
        id: `role:${id}`,
        kind: 'role',
        risk: 'review',
        sql: 'INSERT INTO "Entity" ("id", "name", "entity") VALUES ' +
          `(${sqlLiteral(id)}, ${sqlLiteral(role.name)}, 'Role'); ` +
          'INSERT INTO "Role" ("id", "description") VALUES ' +
          `(${sqlLiteral(id)}, ${sqlLiteral(role.description ?? '')})`,
        target: id,
      })
      continue
    }
    if (!sameRole(role, actualRole)) {
      const previousRole = previousRoles.get(id)
      if (!previousRole || sameRole(previousRole, actualRole)) {
        operations.push({
          dependsOn: ['table:Entity', 'table:Role'],
          id: `role:${id}:replace`,
          kind: 'role',
          risk: 'review',
          sql: `UPDATE "Entity" SET "name" = ${sqlLiteral(role.name)} WHERE "id" = ${sqlLiteral(id)}; ` +
            `UPDATE "Role" SET "description" = ${sqlLiteral(role.description ?? '')} ` +
            `WHERE "id" = ${sqlLiteral(id)}`,
          target: id,
        })
      } else {
        drift.push(`role definition changed: ${id}`)
      }
    }
  }
  for (const [id] of actualRoles) {
    if (previousRoles.has(id) || desiredRoles.has(id)) continue
    drift.push(`unexpected role: ${id}`)
  }
  for (const [id] of previousRoles) {
    if (desiredRoles.has(id)) continue
    if (!actualRoles.has(id)) continue
    operations.push({
      dependsOn: ['table:Entity', 'table:Role'],
      id: `drop-role:${id}`,
      kind: 'role',
      risk: 'data',
      sql: `DELETE FROM "Role" WHERE "id" = ${sqlLiteral(id)}; ` +
        `DELETE FROM "Entity" WHERE "id" = ${sqlLiteral(id)}`,
      target: id,
    })
  }

  const previousTables = new Set<string>()
  if (previous) {
    for (const table of previous.tables) {
      if (!table.name.startsWith('basis.')) previousTables.add(table.name)
    }
  }
  const desiredNames = new Set(desired.tables.map(table => table.name))
  const desiredOnly = [...desiredNames].filter(name => !previousTables.has(name) && !name.startsWith('basis.'))
  const previousOnly = [...previousTables].filter(name => !desiredNames.has(name))
  if (previousOnly.length > 0 && desiredOnly.length > 0) {
    for (const previousName of previousOnly) {
      for (const next of desiredOnly) ambiguities.push(`${previousName} -> ${next}`)
    }
  }

  const actualFunctionMapForBaseline = new Map(options.actual.functions.map(fn => [fn.name, fn]))
  for (const [name, previousTable] of previousTablesPhysical) {
    const actualTable = actualTables.get(name)
    if (!actualTable) continue
    const actualColumns = new Map(actualTable.columns.map(column => [column.name, column]))
    for (const previousColumn of previousTable.columns) {
      const actualColumn = actualColumns.get(previousColumn.name)
      if (!actualColumn) {
        drift.push(`missing deployed column: ${name}.${previousColumn.name}`)
      } else if (!sameType(previousColumn.sqlType, actualColumn.sqlType)
        || previousColumn.nullable !== actualColumn.nullable) {
        drift.push(`out-of-band column definition change: ${name}.${previousColumn.name}`)
      }
    }
    if (previousTable.primaryKey.join(',') !== actualTable.primaryKey.join(',')) {
      drift.push(`out-of-band primary key change: ${name}`)
    }
    if (previousTable.rowSecurity !== undefined && previousTable.rowSecurity !== actualTable.rowSecurity) {
      drift.push(`out-of-band RLS state change: ${name}`)
    }
    const actualIndexes = new Map(actualTable.indexes.map(index => [index.name, index]))
    for (const previousIndex of previousTable.indexes) {
      const actualIndex = actualIndexes.get(previousIndex.name)
      if (!actualIndex) {
        drift.push(`missing deployed index: ${name}.${previousIndex.name}`)
      } else if (
        (previousIndex.unique !== undefined && actualIndex.unique !== previousIndex.unique)
        || (previousIndex.columns !== undefined
          && (actualIndex.columns ?? []).join(',') !== previousIndex.columns.join(','))
      ) {
        drift.push(`out-of-band index definition change: ${name}.${previousIndex.name}`)
      }
    }
  }
  const actualConstraintsForBaseline = new Map(
    options.actual.constraints.map(constraint => [constraint.name, constraint]),
  )
  for (const previousConstraint of previous?.constraints ?? []) {
    const actualConstraint = actualConstraintsForBaseline.get(previousConstraint.name)
    if (!actualConstraint) {
      drift.push(`missing deployed constraint: ${previousConstraint.name}`)
    } else if (
      previousConstraint.definition !== undefined
      && normalizeDefinition(previousConstraint.definition) !== normalizeDefinition(actualConstraint.definition ?? '')
    ) {
      drift.push(`out-of-band constraint definition change: ${previousConstraint.name}`)
    }
  }
  for (const previousFunction of previous?.functions ?? []) {
    for (const name of previousFunction.required) {
      const actualFunction = actualFunctionMapForBaseline.get(name)
      if (!actualFunction) {
        if (desiredFunctionNamesForPlan(desired).has(name)) {
          drift.push(`missing deployed function: ${name}`)
        }
        continue
      }
      if (previousFunction.body !== undefined && actualFunction.body !== undefined
        && normalizeBody(previousFunction.body) !== normalizeBody(actualFunction.body)) {
        drift.push(`out-of-band function definition change: ${name}`)
      }
      if (previousFunction.securityDefiner !== undefined && actualFunction.securityDefiner !== undefined
        && previousFunction.securityDefiner !== actualFunction.securityDefiner) {
        drift.push(`out-of-band function security change: ${name}`)
      }
      if (previousFunction.signature !== undefined && actualFunction.signature !== undefined
        && normalizeDefinition(previousFunction.signature) !== normalizeDefinition(actualFunction.signature)) {
        drift.push(`out-of-band function signature change: ${name}`)
      }
      if (previousFunction.searchPath !== undefined
        && (actualFunction.searchPath === undefined
          || normalizeSearchPath(previousFunction.searchPath) !== normalizeSearchPath(actualFunction.searchPath))) {
        drift.push(`out-of-band function search path change: ${name}`)
      }
    }
  }
  const actualGrantNames = new Set((options.actual.grants ?? []).map(grant => grant.name))
  for (const name of previousGrantNames) {
    if (!actualGrantNames.has(name)) drift.push(`missing deployed grant: ${name}`)
  }
  const actualTriggerMapForBaseline = new Map(options.actual.triggers.map(trigger => [trigger.name, trigger]))
  for (const previousTrigger of previous?.triggers ?? []) {
    const actualTrigger = actualTriggerMapForBaseline.get(previousTrigger.name)
    if (!actualTrigger) {
      drift.push(`missing deployed trigger: ${previousTrigger.name}`)
    } else if (
      (previousTrigger.functionName !== undefined && actualTrigger.functionName !== previousTrigger.functionName)
      || (previousTrigger.type !== undefined && actualTrigger.type !== previousTrigger.type)
      || (previousTrigger.columns !== undefined
        && (actualTrigger.columns ?? []).join(',') !== previousTrigger.columns.join(','))
    ) {
      drift.push(`out-of-band trigger definition change: ${previousTrigger.name}`)
    }
  }
  const actualPolicyMapForBaseline = new Map(options.actual.policies.map(policy => [policy.name, policy]))
  for (const previousPolicy of previous?.policies ?? []) {
    const actualPolicy = actualPolicyMapForBaseline.get(previousPolicy.name)
    if (!actualPolicy) {
      drift.push(`missing deployed policy: ${previousPolicy.name}`)
    } else if (!samePolicy(previousPolicy, actualPolicy)) {
      drift.push(`out-of-band policy definition change: ${previousPolicy.name}`)
    }
  }

  for (const table of desired.tables) {
    const actual = actualTables.get(table.name)
    if (!actual) {
      if (previousTablesPhysical.has(table.name)) {
        drift.push(`missing deployed table: ${table.name}`)
        continue
      }
      operations.push({
        dependsOn: [],
        id: `table:${table.name}`,
        kind: 'table',
        risk: 'safe',
        sql: table.sql,
        target: table.name,
      })
      for (const index of table.indexes) {
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `index:${table.name}:${index.name}`,
          kind: 'index',
          risk: 'safe',
          sql: index.sql,
          target: `${table.name}.${index.name}`,
        })
      }
      if (table.rowSecurity) {
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `rls:${table.name}`,
          kind: 'row-security',
          risk: 'review',
          sql: `ALTER TABLE ${quote(table.name)} ENABLE ROW LEVEL SECURITY`,
          target: table.name,
        })
      }
      if (table.forceRowSecurity) {
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `force-rls:${table.name}`,
          kind: 'row-security',
          risk: 'review',
          sql: `ALTER TABLE ${quote(table.name)} FORCE ROW LEVEL SECURITY`,
          target: table.name,
        })
      }
      continue
    }
    if (actual.primaryKey.join(',') !== table.primaryKey.join(',')) {
      drift.push(`primary key changed: ${table.name}`)
    }
    if (table.rowSecurity && actual.rowSecurity !== true) {
      operations.push({
        dependsOn: [`table:${table.name}`],
        id: `rls:${table.name}`,
        kind: 'row-security',
        risk: 'review',
        sql: `ALTER TABLE ${quote(table.name)} ENABLE ROW LEVEL SECURITY`,
        target: table.name,
      })
    }
    if (table.forceRowSecurity && actual.forceRowSecurity !== true) {
      operations.push({
        dependsOn: [`table:${table.name}`],
        id: `force-rls:${table.name}`,
        kind: 'row-security',
        risk: 'review',
        sql: `ALTER TABLE ${quote(table.name)} FORCE ROW LEVEL SECURITY`,
        target: table.name,
      })
    }
    const actualColumns = new Map(actual.columns.map(column => [column.name, column]))
    for (const column of table.columns) {
      const existing = actualColumns.get(column.name)
      if (!existing) {
        if (previousTablesPhysical.get(table.name)?.columns.some(candidate => candidate.name === column.name)) {
          drift.push(`missing deployed column: ${table.name}.${column.name}`)
          continue
        }
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `column:${table.name}:${column.name}`,
          kind: 'add-column',
          risk: column.nullable || column.primaryKey ? 'safe' : 'data',
          sql: columnSql(table.name, column),
          target: `${table.name}.${column.name}`,
        })
        continue
      }
      const previousColumn = previousTablesPhysical.get(table.name)
        ?.columns.find(candidate => candidate.name === column.name)
      if (!sameType(existing.sqlType, column.sqlType)) {
        if (previousColumn && sameType(previousColumn.sqlType, existing.sqlType)) {
          operations.push({
            dependsOn: [`table:${table.name}`],
            id: `column-type:${table.name}:${column.name}`,
            kind: 'alter-column',
            risk: 'data',
            sql: `ALTER TABLE ${quote(table.name)} ALTER COLUMN ${quote(column.name)} TYPE ${column.sqlType}`,
            target: `${table.name}.${column.name}`,
          })
        } else {
          drift.push(`column type changed: ${table.name}.${column.name} (${existing.sqlType} -> ${column.sqlType})`)
        }
      }
      if (existing.nullable !== column.nullable) {
        if (previousColumn && previousColumn.nullable === existing.nullable) {
          operations.push({
            dependsOn: [`table:${table.name}`],
            id: `column-null:${table.name}:${column.name}`,
            kind: 'alter-column',
            risk: 'review',
            sql: `ALTER TABLE ${quote(table.name)} ALTER COLUMN ${quote(column.name)} ` +
              (column.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'),
            target: `${table.name}.${column.name}`,
          })
        } else {
          drift.push(`column nullability changed: ${table.name}.${column.name}`)
        }
      }
      if (column.default !== undefined && existing.default !== column.default) {
        drift.push(`column default changed: ${table.name}.${column.name}`)
      }
    }
    const desiredColumns = new Set(table.columns.map(column => column.name))
    const previousTable = previousTablesPhysical.get(table.name)
    for (const column of actual.columns) {
      if (desiredColumns.has(column.name)) continue
      const previousColumn = previousTable?.columns.find(candidate => candidate.name === column.name)
      if (previousColumn) {
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `drop-column:${table.name}:${column.name}`,
          kind: 'drop-column',
          risk: 'data',
          sql: `ALTER TABLE ${quote(table.name)} DROP COLUMN ${quote(column.name)}`,
          target: `${table.name}.${column.name}`,
        })
      } else {
        drift.push(`unexpected column: ${table.name}.${column.name}`)
      }
    }
    const actualIndexes = new Map(actual.indexes.map(index => [index.name, index]))
    for (const index of table.indexes) {
      const existing = actualIndexes.get(index.name)
      if (!existing) {
        if (previousTablesPhysical.get(table.name)?.indexes.some(candidate => candidate.name === index.name)) {
          drift.push(`missing deployed index: ${table.name}.${index.name}`)
          continue
        }
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `index:${table.name}:${index.name}`,
          kind: 'index',
          risk: 'safe',
          sql: index.sql,
          target: `${table.name}.${index.name}`,
        })
        continue
      }
      if (
        existing.valid === false
        || (index.unique !== undefined && existing.unique !== index.unique)
        || (index.columns !== undefined && (existing.columns ?? []).join(',') !== index.columns.join(','))
      ) {
        drift.push(`index definition changed: ${table.name}.${index.name}`)
      }
    }
    for (const index of actualIndexes.values()) {
      if (!table.indexes.some(desiredIndex => desiredIndex.name === index.name)) {
        drift.push(`unexpected index: ${table.name}.${index.name}`)
      }
    }
  }
  for (const table of options.actual.tables) {
    if (desiredTables.has(table.name) || ambiguities.some(pair => pair.startsWith(`${table.name} ->`))) continue
    if (previousTables.has(table.name)) {
      operations.push({
        dependsOn: [],
        id: `drop-table:${table.name}`,
        kind: 'table',
        risk: 'data',
        sql: `DROP TABLE ${quote(table.name)}`,
        target: table.name,
      })
    } else {
      drift.push(`unexpected table: ${table.name}`)
    }
  }

  const actualConstraints = new Map(options.actual.constraints.map(constraint => [constraint.name, constraint]))
  for (const constraint of desired.constraints) {
    const existing = actualConstraints.get(constraint.name)
    if (!existing) {
      if (previousConstraints.has(constraint.name)) {
        drift.push(`missing deployed constraint: ${constraint.name}`)
        continue
      }
      operations.push({
        dependsOn: [],
        id: `constraint:${constraint.name}`,
        kind: 'constraint',
        risk: 'safe',
        sql: constraint.sql,
        target: constraint.name,
      })
      continue
    }
    if (
      constraint.definition !== undefined
      && normalizeDefinition(existing.definition ?? '') !== normalizeDefinition(constraint.definition)
    ) {
      drift.push(`constraint definition changed: ${constraint.name}`)
    }
  }
  const desiredConstraints = new Set(desired.constraints.map(constraint => constraint.name))
  for (const constraint of options.actual.constraints) {
    if (desiredConstraints.has(constraint.name) || removedTables.has(constraint.table)) continue
    drift.push(`unexpected constraint: ${constraint.name}`)
  }

  const actualFunctionMap = new Map(options.actual.functions.map(fn => [fn.name, fn]))
  for (const fn of desired.functions) {
    if (!fn.required.every(name => actualFunctions.has(name))) {
      if (fn.required.some(name => previousFunctions.has(name))) {
        for (const name of fn.required) {
          if (!actualFunctions.has(name) && previousFunctions.has(name)) {
            drift.push(`missing deployed function: ${name}`)
          }
        }
        continue
      }
      operations.push({
        dependsOn: [],
        id: `function:${fn.name}`,
        kind: 'function',
        risk: 'review',
        sql: fn.sql,
        target: fn.name,
      })
      continue
    }
    const actualFunction = actualFunctionMap.get(fn.name)
    const changedBody = fn.body !== undefined && actualFunction?.body !== undefined
      && normalizeBody(actualFunction.body) !== normalizeBody(fn.body)
    const changedSecurity = fn.securityDefiner !== undefined
      && actualFunction?.securityDefiner !== undefined
      && actualFunction.securityDefiner !== fn.securityDefiner
    const changedSignature = fn.signature !== undefined && actualFunction?.signature !== undefined
      && normalizeDefinition(fn.signature) !== normalizeDefinition(actualFunction.signature)
    const changedSearchPath = fn.searchPath !== undefined
      && (actualFunction?.searchPath === undefined
        || normalizeSearchPath(fn.searchPath) !== normalizeSearchPath(actualFunction.searchPath))
    if (actualFunction && (changedBody || changedSecurity || changedSignature || changedSearchPath)) {
      const prior = previousFunctionMap.get(fn.name)
      const priorMatchesActual = prior?.body !== undefined && actualFunction.body !== undefined
        && normalizeBody(prior.body) === normalizeBody(actualFunction.body)
        && (prior.securityDefiner === undefined || actualFunction.securityDefiner === undefined
          || prior.securityDefiner === actualFunction.securityDefiner)
        && (prior.signature === undefined || actualFunction.signature === undefined
          || normalizeDefinition(prior.signature) === normalizeDefinition(actualFunction.signature))
        && (prior.searchPath === undefined
          || (actualFunction.searchPath !== undefined
            && normalizeSearchPath(prior.searchPath) === normalizeSearchPath(actualFunction.searchPath)))
      if (priorMatchesActual) {
        operations.push({
          dependsOn: [],
          id: `function:${fn.name}:replace`,
          kind: 'function',
          risk: 'review',
          sql: fn.sql,
          target: fn.name,
        })
      } else {
        drift.push(`function definition changed: ${fn.name}`)
      }
    }
  }
  const desiredFunctionNames = new Set(desired.functions.flatMap(fn => fn.required))
  for (const name of actualFunctions) {
    if (desiredFunctionNames.has(name)) continue
    if (previousFunctions.has(name)) {
      operations.push({
        dependsOn: [],
        id: `drop-function:${name}`,
        kind: 'function',
        risk: 'review',
        sql: `DROP FUNCTION ${quote(name)}(${previousFunctionMap.get(name)?.signature ?? ''})`,
        target: name,
      })
    } else {
      drift.push(`unexpected function: ${name}`)
    }
  }

  const actualTriggerMap = new Map(options.actual.triggers.map(trigger => [trigger.name, trigger]))
  for (const trigger of desired.triggers) {
    const existing = actualTriggerMap.get(trigger.name)
    if (!existing) {
      if (previousTriggers.has(trigger.name)) {
        drift.push(`missing deployed trigger: ${trigger.name}`)
        continue
      }
      operations.push({
        dependsOn: [`table:${trigger.table}`],
        id: `trigger:${trigger.name}`,
        kind: 'trigger',
        risk: 'review',
        sql: trigger.sql,
        target: trigger.name,
      })
      continue
    }
    if (
      (existing.enabled !== undefined && existing.enabled !== 'O')
      || (trigger.functionName !== undefined && existing.functionName !== trigger.functionName)
      || (trigger.type !== undefined && existing.type !== trigger.type)
      || (trigger.columns !== undefined
        && (existing.columns ?? []).join(',') !== trigger.columns.join(','))
    ) {
      drift.push(`trigger definition changed: ${trigger.name}`)
    }
  }
  const desiredTriggerNames = new Set(desired.triggers.map(trigger => trigger.name))
  for (const name of actualTriggers) {
    if (desiredTriggerNames.has(name)) continue
    const trigger = actualTriggerMap.get(name)
    if (trigger && removedTables.has(trigger.table)) continue
    if (previousTriggers.has(name) && trigger) {
      operations.push({
        dependsOn: [],
        id: `drop-trigger:${name}`,
        kind: 'trigger',
        risk: 'review',
        sql: `DROP TRIGGER ${quote(name)} ON ${quote(trigger.table)}`,
        target: name,
      })
    } else {
      drift.push(`unexpected trigger: ${name}`)
    }
  }

  const actualPolicyMap = new Map(options.actual.policies.map(policy => [policy.name, policy]))
  for (const policy of desired.policies) {
    const existing = actualPolicyMap.get(policy.name)
    if (!existing) {
      if (previousPolicies.has(policy.name)) {
        drift.push(`missing deployed policy: ${policy.name}`)
        continue
      }
      operations.push({
        dependsOn: [`table:${policy.table}`],
        id: `policy:${policy.name}`,
        kind: 'policy',
        risk: 'review',
        sql: policy.sql,
        target: policy.name,
      })
      continue
    }
    if (!samePolicy(policy, existing)) {
      const previousPolicy = previous?.policies.find(candidate => candidate.name === policy.name)
      if (previousPolicy && samePolicy(previousPolicy, existing)) {
        operations.push({
          dependsOn: [`table:${policy.table}`],
          id: `policy:${policy.name}:replace`,
          kind: 'policy',
          risk: 'review',
          sql: `DROP POLICY IF EXISTS ${quote(policy.name)} ON ${quote(policy.table)}; ${policy.sql}`,
          target: policy.name,
        })
      } else {
        drift.push(`policy definition changed: ${policy.name}`)
      }
    }
  }
  const desiredPolicyNames = new Set(desired.policies.map(policy => policy.name))
  for (const name of actualPolicies) {
    if (desiredPolicyNames.has(name)) continue
    const policy = actualPolicyMap.get(name)
    if (policy && removedTables.has(policy.table)) continue
    drift.push(`unexpected policy: ${name}`)
  }

  const plannedIds = new Set(operations.map(operation => operation.id))
  const schemaOperation = operations.find(operation => operation.kind === 'schema' && operation.target === 'basis')
  const functionOperations = operations.filter(operation => operation.kind === 'function')
  const tableOperations = new Set(operations
    .filter(operation => operation.kind === 'table')
    .map(operation => operation.target))
  for (const operation of operations) {
    const dependencies = new Set(operation.dependsOn.filter(dependency => plannedIds.has(dependency)))
    if (
      schemaOperation
      && (operation.kind === 'policy' || operation.kind === 'function' || operation.kind === 'grant'
        || (operation.kind === 'table' && operation.target.startsWith('basis.')))
    ) {
      dependencies.add(schemaOperation.id)
    }
    if (operation.kind === 'trigger') {
      const trigger = desired.triggers.find(candidate => candidate.name === operation.target)
      const dependency = functionOperations.find(candidate => candidate.target === trigger?.functionName)
      if (dependency) dependencies.add(dependency.id)
    }
    if (operation.kind === 'policy') {
      for (const dependency of functionOperations) dependencies.add(dependency.id)
    }
    if (operation.kind === 'grant') {
      const grant = desired.grants?.find(candidate => candidate.name === operation.target)
      if (grant?.table && tableOperations.has(grant.table)) {
        dependencies.add(`table:${grant.table}`)
      }
      if (grant?.function) {
        const dependency = functionOperations.find(candidate => candidate.target === grant.function)
        if (dependency) dependencies.add(dependency.id)
      }
    }
    if (operation.kind === 'constraint') {
      const constraint = desired.constraints.find(candidate => candidate.name === operation.target)
      if (constraint?.target && tableOperations.has(constraint.target)) {
        dependencies.add(`table:${constraint.target}`)
      }
    }
    if (operation.kind === 'index' || operation.kind === 'constraint'
      || operation.kind === 'trigger' || operation.kind === 'policy'
      || operation.kind === 'row-security' || operation.kind === 'add-column'
      || operation.kind === 'alter-column' || operation.kind === 'drop-column') {
      let tableTarget = operation.target.split(':')[0]?.split('.')[0] ?? ''
      if (operation.kind === 'policy') {
        tableTarget = desired.policies.find(policy => policy.name === operation.target)?.table ?? tableTarget
      }
      if (operation.kind === 'trigger') {
        tableTarget = desired.triggers.find(trigger => trigger.name === operation.target)?.table ?? tableTarget
      }
      if (operation.kind === 'constraint') {
        tableTarget = desired.constraints.find(constraint => constraint.name === operation.target)?.table ?? tableTarget
      }
      if (tableOperations.has(tableTarget)) dependencies.add(`table:${tableTarget}`)
    }
    operation.dependsOn = [...dependencies]
  }
  operations.sort((left, right) => (
    (PHASE[left.kind] ?? 99) - (PHASE[right.kind] ?? 99)
    || left.id.localeCompare(right.id)
  ))
  return {
    ambiguities,
    blocked: ambiguities.length > 0 || drift.length > 0,
    drift,
    operations: operations.map(operation => ({
      ...operation,
      preconditions: operation.kind === 'alter-column'
        ? ['explicit cast/backfill resolution required', 'target table exists']
        : operation.dependsOn.length > 0
          ? operation.dependsOn.map(dependency => `completed:${dependency}`)
          : ['schema is writable'],
    })),
  }
}

/**
 * Hash canonical authoring source for deterministic snapshots.
 * @param source - Canonical JSON source.
 * @returns The SHA-256 hex digest.
 */
export function hash(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

/**
 * The canonical schema-planning capability.
 */
export const DDL = { hash, introspect, plan }

/**
 * Normalize a function search_path setting.
 * @param value - Search path setting.
 * @returns Comparable search path text.
 */
function normalizeSearchPath(value: string): string {
  return normalizeDefinition(value.replace(/^search_path=/iu, ''))
}

/**
 * Compare two graph-managed role rows.
 * @param left - Previous or desired role.
 * @param right - Actual or desired role.
 * @returns Whether the role metadata is equal.
 */
function sameRole(left: PhysicalRole, right: PhysicalRole): boolean {
  return left.id === right.id
    && left.name === right.name
    && (left.description ?? '') === (right.description ?? '')
}

/**
 * Quote one SQL string literal.
 * @param value - Literal text.
 * @returns Quoted SQL literal.
 */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Compare two typed policy definitions semantically.
 * @param left - Desired or previous policy.
 * @param right - Observed or desired policy.
 * @returns Whether the policy metadata is equivalent.
 */
function samePolicy(left: PhysicalPolicy, right: PhysicalPolicy): boolean {
  const definition = left.definition === undefined || right.definition === undefined
    ? left.definition === right.definition
    : normalizePolicyDefinition(left.definition) === normalizePolicyDefinition(right.definition)
  const command = left.command === undefined || right.command === undefined
    ? left.command === right.command
    : left.command === right.command
  const permissive = left.permissive === undefined || right.permissive === undefined
    ? left.permissive === right.permissive
    : left.permissive === right.permissive
  const roles = left.roles === undefined || right.roles === undefined
    ? left.roles === right.roles
    : [...left.roles].sort().join(',') === [...right.roles].sort().join(',')
  return definition && command && permissive && roles
}

/**
 * Normalize a PostgreSQL policy expression for catalog comparison.
 *
 * PostgreSQL rewrites equivalent expressions (casts, qualifiers, IS DISTINCT
 * FROM negation, aliases, and redundant parentheses) when storing a policy.
 * This comparison form removes those representation differences while
 * preserving literal contents and predicate values.
 * @param value - Policy definition text.
 * @returns Comparable policy definition.
 */
function normalizePolicyDefinition(value: string): string {
  let normalized = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (character === "'") {
      normalized += character
      if (quoted && value[index + 1] === "'") {
        normalized += "'"
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (quoted) {
      normalized += character
      continue
    }
    if (character === '"' || character === ';') continue
    normalized += character.toLowerCase()
  }
  normalized = normalized.replace(/::[a-z_][a-z0-9_ ]*/gu, '')
  normalized = normalized.replace(
    /(^|[\s(,=])(?!basis\.)[a-z_][a-z0-9_]*\./gu,
    (_match, prefix: string) => prefix,
  )
  normalized = normalized.replace(/\s+/gu, '')
  for (let pass = 0; pass < 4; pass += 1) {
    normalized = normalized.replace(/not\(([^()]*)isdistinctfrom([^()]*)\)/gu, '$1isnotdistinctfrom$2')
  }
  return normalized.replaceAll('(', '').replaceAll(')', '')
}

/**
 * Normalize a function body without altering string literals.
 * @param value - Function body.
 * @returns Comparable body text.
 */
function normalizeBody(value: string): string {
  return value.replaceAll('\r\n', '\n').trim()
}

/**
 * Normalize SQL for defensive catalog comparison.
 * @param value - SQL or catalog expression.
 * @returns Comparable text.
 */
function normalizeDefinition(value: string): string {
  let normalized = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (character === "'") {
      normalized += character
      if (quoted && value[index + 1] === "'") {
        normalized += "'"
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (quoted) {
      normalized += character
      continue
    }
    if (character === '"' || /\s/u.test(character)) continue
    normalized += character.toLowerCase()
  }
  return normalized.replaceAll('initiallyimmediate', '')
}

/**
 * Build one add-column statement.
 * @param table - Owning table.
 * @param column - Typed column.
 * @returns The ALTER TABLE statement.
 */
function columnSql(table: string, column: PhysicalColumn): string {
  const nullable = column.nullable || column.primaryKey ? '' : ' NOT NULL'
  return `ALTER TABLE ${quote(table)} ADD COLUMN ${quote(column.name)} ${column.sqlType}${nullable}`
}

/**
 * Compare two physical SQL type names.
 * @param left - Catalog type.
 * @param right - Desired type.
 * @returns Whether they are equivalent enough for planning.
 */
function sameType(left: string, right: string): boolean {
  if (left === 'ARRAY' && right.endsWith('[]')) return true
  if (right === 'ARRAY' && left.endsWith('[]')) return true
  const normalize = (value: string): string => value
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('double precision', 'double precision')
  return normalize(left) === normalize(right)
}

/**
 * Quote one PostgreSQL identifier.
 * @param identifier - Identifier or dotted name.
 * @returns Quoted identifier.
 */
function quote(identifier: string): string {
  return identifier.split('.').map(part => `"${part.replaceAll('"', '""')}"`).join('.')
}
