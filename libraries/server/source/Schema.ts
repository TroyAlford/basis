import type { SQL as BunSQL } from 'bun'
import { createHash } from 'node:crypto'
import type { EntityDefinitions } from './EntityDefinitions'

/** The category of one physical schema object. */
export type PhysicalKind = 'constraint' | 'extension' | 'function' | 'index' | 'policy' | 'table' | 'trigger'

/** One typed physical column. */
export interface PhysicalColumn {
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
  /** Index name. */
  readonly name: string,
  /** Complete create-index SQL when compiled from a desired model. */
  readonly sql: string,
  /** Owning table name. */
  readonly table: string,
}

/** One typed physical constraint. */
export interface PhysicalConstraint {
  /** Constraint name. */
  readonly name: string,
  /** Complete add-constraint SQL. */
  readonly sql: string,
  /** Owning table name. */
  readonly table: string,
}

/** One typed physical table. */
export interface PhysicalTable {
  /** Typed columns. */
  readonly columns: readonly PhysicalColumn[],
  /** Indexes owned by the table. */
  readonly indexes: readonly PhysicalIndex[],
  /** Table name, qualified with `basis.` for internal tables. */
  readonly name: string,
  /** Primary-key columns. */
  readonly primaryKey: readonly string[],
  /** Complete create-table SQL. */
  readonly sql: string,
}

/** One typed function or function group. */
export interface PhysicalFunction {
  /** Stable object name. */
  readonly name: string,
  /** Required PostgreSQL function names for this compiled object. */
  readonly required: readonly string[],
  /** Complete function DDL. */
  readonly sql: string,
}

/** One typed trigger. */
export interface PhysicalTrigger {
  /** Trigger name. */
  readonly name: string,
  /** Complete create-trigger SQL. */
  readonly sql: string,
  /** Owning table. */
  readonly table: string,
}

/** One typed row-level policy. */
export interface PhysicalPolicy {
  /** Policy name. */
  readonly name: string,
  /** Complete create-policy SQL. */
  readonly sql: string,
  /** Owning table. */
  readonly table: string,
}

/** One typed physical grant or revoke statement. */
export interface PhysicalGrant {
  /** Stable object name. */
  readonly name: string,
  /** Complete grant or revoke SQL. */
  readonly sql: string,
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
  /** Tables. */
  readonly tables: readonly PhysicalTable[],
  /** Triggers. */
  readonly triggers: readonly PhysicalTrigger[],
}

/** One deterministic schema operation. */
export interface SchemaOperation {
  /** Objects this operation requires first. */
  readonly dependsOn: readonly string[],
  /** Stable operation id. */
  readonly id: string,
  /** Operation category. */
  readonly kind: PhysicalKind | 'add-column',
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

/** Planning inputs. */
export interface PlanOptions {
  /** Live catalog snapshot. */
  readonly actual: PhysicalSchema,
  /** Restricted app role used by security DDL. */
  readonly appRole?: string,
  /** Desired canonical definitions. */
  readonly desired: EntityDefinitions,
  /** Whether to include security objects in the desired schema. */
  readonly includeAuthorization?: boolean,
  /** Previous deployed definitions, when available. */
  readonly previous?: EntityDefinitions,
  /** Whether the provisioning connection can force owner RLS. */
  readonly superuser?: boolean,
}

/** Order operations from prerequisites to dependants. */
const PHASE: Readonly<Record<string, number>> = {
  'add-column': 3,
  'constraint': 5,
  'extension': 0,
  'function': 6,
  'index': 4,
  'policy': 7,
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
  const tableRows = await sql<{ schema: string, table: string }[]>`
    SELECT table_schema AS schema, table_name AS TABLE
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema IN (current_schema(), 'basis')
    ORDER BY table_schema, table_name
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
  const indexRows = await sql<{ definition: string, index: string, schema: string, table: string }[]>`
    SELECT schemaname AS schema, tablename AS TABLE, indexname AS INDEX, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname IN (current_schema(), 'basis') AND indexname NOT LIKE '%_pkey'
    ORDER BY schemaname, tablename, indexname
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
  const functionRows = await sql<{ name: string }[]>`
    SELECT CASE WHEN n.nspname = 'basis' THEN 'basis.' || p.proname ELSE p.proname END AS name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN (current_schema(), 'basis')
    ORDER BY n.nspname, p.proname
  `
  const triggerRows = await sql<{ name: string, table: string }[]>`
    SELECT event_object_table AS TABLE, trigger_name AS name
    FROM information_schema.triggers
    WHERE trigger_schema IN (current_schema(), 'basis')
    ORDER BY event_object_schema, event_object_table, trigger_name
  `
  const policyRows = await sql<{
    name: string,
    schema: string,
    table: string,
  }[]>`
    SELECT schemaname AS schema, tablename AS TABLE, policyname AS name
    FROM pg_policies
    WHERE schemaname IN (current_schema(), 'basis')
    ORDER BY schemaname, tablename, policyname
  `

  const columnsByTable = new Map<string, PhysicalColumn[]>()
  for (const row of columnRows) {
    const name = `${row.schema === 'basis' ? 'basis.' : ''}${row.table}`
    const columns = columnsByTable.get(name) ?? []
    columns.push({
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
    indexes.push({ name: row.index, sql: row.definition, table: name })
    indexesByTable.set(name, indexes)
  }
  const tables: PhysicalTable[] = tableRows.map(row => {
    const name = `${row.schema === 'basis' ? 'basis.' : ''}${row.table}`
    return {
      columns: columnsByTable.get(name) ?? [],
      indexes: indexesByTable.get(name) ?? [],
      name,
      primaryKey: [],
      sql: '',
    }
  })
  return {
    constraints: constraintRows.map(row => ({
      name: row.constraint,
      sql: `ALTER TABLE ${quote(row.schema === 'basis' ? `basis.${row.table}` : row.table)} ` +
        `ADD CONSTRAINT ${quote(row.constraint)} ${row.definition}`,
      table: row.schema === 'basis' ? `basis.${row.table}` : row.table,
    })),
    extensions: extensions.map(row => row.name),
    functions: functionRows.map(row => ({ name: row.name, required: [row.name], sql: '' })),
    policies: policyRows.map(row => ({
      name: row.name,
      sql: '',
      table: row.schema === 'basis' ? `basis.${row.table}` : row.table,
    })),
    tables,
    triggers: triggerRows.map(row => ({
      name: row.name,
      sql: '',
      table: row.table,
    })),
  }
}

/**
 * Plan a non-mutating schema transition from the live catalog to a desired model.
 * @param options - Previous and desired definitions plus the live catalog.
 * @returns The deterministic plan.
 */
export function plan(options: PlanOptions): SchemaPlan {
  const desired = options.desired.physicalSchema(
    options.appRole,
    options.superuser,
    options.includeAuthorization ?? true,
  )
  const actualTables = new Map(options.actual.tables.map(table => [table.name, table]))
  const desiredTables = new Map(desired.tables.map(table => [table.name, table]))
  const actualFunctions = new Set(options.actual.functions.flatMap(fn => fn.required))
  const actualTriggers = new Set(options.actual.triggers.map(trigger => trigger.name))
  const actualPolicies = new Set(options.actual.policies.map(policy => policy.name))
  const actualExtensions = new Set(options.actual.extensions)
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

  const previousTables = new Set<string>()
  if (options.previous) {
    previousTables.add('Entity')
    for (const entity of options.previous.entities) previousTables.add(entity.name)
    for (const relationship of options.previous.relationships) previousTables.add(relationship.name)
  }
  const desiredNames = new Set(desired.tables.map(table => table.name))
  const desiredOnly = [...desiredNames].filter(name => !previousTables.has(name) && !name.startsWith('basis.'))
  const previousOnly = [...previousTables].filter(name => !desiredNames.has(name))
  if (previousOnly.length > 0 && desiredOnly.length > 0) {
    for (const previous of previousOnly) {
      for (const next of desiredOnly) ambiguities.push(`${previous} -> ${next}`)
    }
  }

  for (const table of desired.tables) {
    const actual = actualTables.get(table.name)
    if (!actual) {
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
      continue
    }
    const actualColumns = new Map(actual.columns.map(column => [column.name, column]))
    for (const column of table.columns) {
      const existing = actualColumns.get(column.name)
      if (!existing) {
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
      if (!sameType(existing.sqlType, column.sqlType)) {
        drift.push(`column type changed: ${table.name}.${column.name} (${existing.sqlType} -> ${column.sqlType})`)
      }
      if (existing.nullable !== column.nullable) {
        drift.push(`column nullability changed: ${table.name}.${column.name}`)
      }
    }
    const desiredColumns = new Set(table.columns.map(column => column.name))
    for (const column of actual.columns) {
      if (!desiredColumns.has(column.name)) drift.push(`unexpected column: ${table.name}.${column.name}`)
    }
    const actualIndexes = new Map(actual.indexes.map(index => [index.name, index]))
    for (const index of table.indexes) {
      if (!actualIndexes.has(index.name)) {
        operations.push({
          dependsOn: [`table:${table.name}`],
          id: `index:${table.name}:${index.name}`,
          kind: 'index',
          risk: 'safe',
          sql: index.sql,
          target: `${table.name}.${index.name}`,
        })
      }
    }
    for (const index of actualIndexes.values()) {
      if (!table.indexes.some(desiredIndex => desiredIndex.name === index.name)) {
        drift.push(`unexpected index: ${table.name}.${index.name}`)
      }
    }
  }
  for (const table of options.actual.tables) {
    if (!desiredTables.has(table.name) && !ambiguities.some(pair => pair.startsWith(`${table.name} ->`))) {
      drift.push(`unexpected table: ${table.name}`)
    }
  }

  const actualConstraints = new Set(options.actual.constraints.map(constraint => constraint.name))
  for (const constraint of desired.constraints) {
    if (!actualConstraints.has(constraint.name)) {
      operations.push({
        dependsOn: [],
        id: `constraint:${constraint.name}`,
        kind: 'constraint',
        risk: 'safe',
        sql: constraint.sql,
        target: constraint.name,
      })
    }
  }
  const desiredConstraints = new Set(desired.constraints.map(constraint => constraint.name))
  for (const constraint of options.actual.constraints) {
    if (!desiredConstraints.has(constraint.name)) drift.push(`unexpected constraint: ${constraint.name}`)
  }

  for (const fn of desired.functions) {
    if (!fn.required.every(name => actualFunctions.has(name))) {
      operations.push({
        dependsOn: [],
        id: `function:${fn.name}`,
        kind: 'function',
        risk: 'review',
        sql: fn.sql,
        target: fn.name,
      })
    }
  }
  const desiredFunctionNames = new Set(desired.functions.flatMap(fn => fn.required))
  for (const name of actualFunctions) {
    if (!desiredFunctionNames.has(name)) drift.push(`unexpected function: ${name}`)
  }

  for (const trigger of desired.triggers) {
    if (!actualTriggers.has(trigger.name)) {
      operations.push({
        dependsOn: [],
        id: `trigger:${trigger.name}`,
        kind: 'trigger',
        risk: 'review',
        sql: trigger.sql,
        target: trigger.name,
      })
    }
  }
  const desiredTriggerNames = new Set(desired.triggers.map(trigger => trigger.name))
  for (const name of actualTriggers) {
    if (!desiredTriggerNames.has(name)) drift.push(`unexpected trigger: ${name}`)
  }

  for (const policy of desired.policies) {
    if (!actualPolicies.has(policy.name)) {
      operations.push({
        dependsOn: [],
        id: `policy:${policy.name}`,
        kind: 'policy',
        risk: 'review',
        sql: policy.sql,
        target: policy.name,
      })
    }
  }
  const desiredPolicyNames = new Set(desired.policies.map(policy => policy.name))
  for (const name of actualPolicies) {
    if (!desiredPolicyNames.has(name)) drift.push(`unexpected policy: ${name}`)
  }

  operations.sort((left, right) => (
    (PHASE[left.kind] ?? 99) - (PHASE[right.kind] ?? 99)
    || left.id.localeCompare(right.id)
  ))
  return {
    ambiguities,
    blocked: ambiguities.length > 0 || drift.length > 0,
    drift,
    operations,
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
