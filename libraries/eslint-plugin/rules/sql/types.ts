/* eslint-disable camelcase */
import type { Node } from 'libpg-query'

/**
 * A PostgreSQL AST node tagged with its single protocol key.
 *
 * `libpg-query` represents every node as `{ SelectStmt: {...} }`. Distributing
 * the mapped type over the protocol union keeps each value correlated with its
 * kind, so a switch on `node.kind` narrows `node.value` without casts.
 */
export type PgNode = Node extends infer Candidate
  ? Candidate extends object
    ? { [K in keyof Candidate]: { kind: K, value: Candidate[K] } }[keyof Candidate]
    : never
  : never

/** Every node kind exposed by the PostgreSQL protocol. */
export type PgKind = PgNode['kind']

/** Raised when a node kind or a meaningful variant has no faithful printer. */
export class UnsupportedNodeError extends Error {
  constructor(readonly nodeKind: string, readonly detail?: string) {
    super(detail === undefined
      ? `SQL formatter: unsupported AST node "${nodeKind}"`
      : `SQL formatter: unsupported ${nodeKind} (${detail})`)
  }
}

/** Raised when a supported printer cannot preserve meaning. */
export class SemanticError extends Error {
  constructor(message: string) {
    super(`SQL formatter: ${message}`)
  }
}

/**
 * Find the single protocol key of a raw AST value.
 * @param value
 */
export function kindOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key of Object.keys(value)) {
    if (key === 'location') continue
    const child = (value as Record<string, unknown>)[key]
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) return key
  }
  return null
}

/**
 * Tag a raw protocol node for dispatch.
 * @param value
 */
export function tagNode(value: Node): PgNode {
  const kind = kindOf(value)
  if (kind === null) throw new UnsupportedNodeError('unknown')
  return { kind, value: (value as Record<string, unknown>)[kind] } as PgNode
}

/**
 * Read a raw node's body without dispatch typing.
 * @param value
 */
export function bodyOf<T>(value: unknown): T {
  const kind = kindOf(value)
  if (kind === null) throw new UnsupportedNodeError('unknown')
  return (value as Record<string, T>)[kind] as T
}

/**
 * Read the string value of a `String` node.
 * @param value
 */
export function stringValue(value: unknown): string {
  return bodyOf<{ sval?: string }>(value).sval ?? ''
}

/**
 * Read the string values of a `String` node list.
 * @param values
 */
export function stringValues(values: readonly unknown[] | undefined): string[] {
  return (values ?? []).map(stringValue)
}

/**
 * Read the boolean value of a `Boolean` node, including protobuf's empty default.
 * @param value
 */
export function booleanValue(value: unknown): boolean {
  return bodyOf<{ boolval?: boolean }>(value).boolval === true
}

/**
 * Read an integer node value.
 * @param value
 */
export function integerValue(value: unknown): number {
  return bodyOf<{ ival?: number }>(value).ival ?? 0
}
