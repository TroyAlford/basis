/* eslint-disable @stylistic/jsx/indent, @stylistic/ts/indent */
import type { PathOf, TypeAt } from '@basis/utilities'
import type { Database, QueryOptions } from '../source/Database'
import type { CreateResult, EditResult, MutationFilter, MutationRecord, UpsertResult } from '../source/Mutation'

/** A generated entity-name to hydrated-interface map. */
export type EntityModels = object
/** A generated entity-name to create-input map. */
export type CreateModels = object
/** A generated entity-name to update-input map. */
export type UpdateModels = object
/** A generated entity-name to reference-target map. */
export type ReferenceModels = object
/** Constraint preserving a map's generated keys while requiring object values. */
type ObjectMap<Map> = { [Key in keyof Map]: object }

/** Reference field map for one entity, when present. */
type ReferenceFields<References extends object, Name extends PropertyKey> =
  Name extends keyof References ? References[Name] : never

/** The first path segment. */
type RootOf<Path extends string> = Path extends `${infer Head}.${string}` ? Head : Path

/** Nested path segments below one root. */
type NestedUnder<Path extends string, Root extends string> =
  Path extends `${Root}.${infer Rest}` ? Rest : never

/** Filter array-index path segments that the query compiler does not project. */
type ValidPath<Path extends string> =
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends `${number}` ? never : `${Head}.${ValidPath<Tail> & string}`
    : Path extends `${number}` ? never : Path

/** Reference-target paths for one entity, bounded against cyclic models. */
type ReferencePaths<
  Models extends ObjectMap<Models>,
  References extends ObjectMap<References>,
  Name extends keyof Models & string,
  Depth extends readonly unknown[] = [],
> = Depth['length'] extends 4
  ? never
  : ReferenceFields<References, Name> extends infer Fields extends object
    ? {
      [Field in keyof Fields & string]:
      Field extends keyof Models[Name]
        ? Fields[Field] extends string
          ? Fields[Field] extends keyof Models
            ? `${Field}.${PathOf<Models[Fields[Field]]> & string}`
                | `${Field}.${ReferencePaths<
                  Models,
                  References,
                  Fields[Field] & keyof Models & string,
                  [...Depth, unknown]
                > & string}`
            : never
          : never
        : never
      }[keyof Fields & string]
    : never

/** Supported typed query paths for one entity. */
export type QueryPath<
  Models extends ObjectMap<Models>,
  References extends ObjectMap<References>,
  Name extends keyof Models & string,
> = (PathOf<Models[Name]> | ReferencePaths<Models, References, Name>) extends infer Path
  ? Path extends string ? ValidPath<Path> : never
  : never

/** Merge a selected nested projection into a reference identity. */
type MergeReference<Value, Projection> = Value extends null
  ? (Exclude<Value, null> & Projection) | null
  : Value & Projection

/** Field names nested below one selected root. */
type NestedFields<Fields extends readonly string[], Root extends string> =
  Fields[number] extends infer Field
    ? Field extends string
      ? NestedUnder<Field, Root> extends infer Nested
        ? Nested extends never ? never : Nested
        : never
      : never
    : never

/** Selected projection for one reference root. */
type ReferenceSelection<
  Models extends ObjectMap<Models>,
  References extends ObjectMap<References>,
  Name extends keyof Models & string,
  Root extends keyof Models[Name] & string,
  Fields extends readonly string[],
> = [NestedFields<Fields, Root>] extends [never]
  ? Models[Name][Root]
  : ReferenceFields<References, Name> extends infer ReferenceFieldsMap extends object
    ? Root extends keyof ReferenceFieldsMap
      ? ReferenceFieldsMap[Root] extends keyof Models
        ? MergeReference<
          Models[Name][Root],
          QuerySelection<
            Models,
            References,
            ReferenceFieldsMap[Root] & keyof Models & string,
            readonly NestedFields<Fields, Root>[]
          >
        >
        : Models[Name][Root]
      : Models[Name][Root]
    : Models[Name][Root]

/** Hydrated shape for one selected field list. */
export type QuerySelection<
  Models extends ObjectMap<Models>,
  References extends ObjectMap<References>,
  Name extends keyof Models & string,
  Fields extends readonly string[],
> = {
  readonly [Root in RootOf<Fields[number]> & keyof Models[Name]]:
  Root extends keyof ReferenceFields<References, Name>
    ? ReferenceSelection<Models, References, Name, Root & string, Fields>
    : TypeAt<Models[Name], Root & string>
}

/** One typed query's options. */
export type TypedQueryOptions<
  Models extends ObjectMap<Models>,
  References extends ObjectMap<References>,
  Name extends keyof Models & string,
  Fields extends readonly QueryPath<Models, References, Name>[],
> = Omit<QueryOptions, 'fields'> & {
  /** Supported effective-field paths. */
  readonly fields: Fields,
}

/** A database facade bound to generated entity and mutation maps. */
export type TypedDatabase<
  Models extends ObjectMap<Models>,
  Creates extends ObjectMap<Creates>,
  Updates extends ObjectMap<Updates>,
  References extends ObjectMap<References>,
> = Omit<Database, 'create' | 'edit' | 'query' | 'upsert'> & {
  /**
   * Create one typed entity.
   * @param entity - Generated entity name.
   * @param values - Typed create payload.
   * @returns The created count and hydrated record.
   */
  create<Name extends keyof Models & keyof Creates & string>(
    entity: Name,
    values: Creates[Name],
  ): Promise<CreateResult<Models[Name] & MutationRecord>>,
  /**
   * Create a typed entity batch.
   * @param entity - Generated entity name.
   * @param values - Typed create payload iterable.
   * @returns The created count.
   */
  create<Name extends keyof Models & keyof Creates & string>(
    entity: Name,
    values: Iterable<Creates[Name]>,
  ): Promise<CreateResult>,
  /**
   * Edit one typed entity set.
   * @param entity - Generated entity name.
   * @param filter - Canonical mutation filter.
   * @param changes - Typed update payload.
   * @returns The edited count and an optional hydrated record.
   */
  edit<Name extends keyof Models & keyof Updates & string>(
    entity: Name,
    filter: MutationFilter,
    changes: Updates[Name],
  ): Promise<EditResult<Models[Name] & MutationRecord>>,
  /**
   * Query one typed entity with typed projection paths.
   * @param entity - Generated entity name.
   * @param options - Query options with supported field paths.
   * @returns The selected hydrated projection.
   */
  query<
    Name extends keyof Models & string,
    const Fields extends readonly QueryPath<Models, References, Name>[],
  >(
    entity: Name,
    options: TypedQueryOptions<Models, References, Name, Fields>,
  ): Promise<readonly QuerySelection<Models, References, Name, Fields>[]>,
  /**
   * Upsert one typed entity.
   * @param entity - Generated entity name.
   * @param filter - Canonical mutation filter.
   * @param values - Typed update/create payload.
   * @returns The branch counts and hydrated record.
   */
  upsert<Name extends keyof Models & keyof Creates & keyof Updates & string>(
    entity: Name,
    filter: MutationFilter,
    values: Creates[Name] | Updates[Name],
  ): Promise<UpsertResult<Models[Name] & MutationRecord>>,
}

/**
 * Bind an existing database to generated entity maps.
 * @param database - Server database capability.
 * @returns The typed facade over the same database.
 */
export function typedDatabase<
  Models extends ObjectMap<Models>,
  Creates extends ObjectMap<Creates>,
  Updates extends ObjectMap<Updates>,
  References extends ObjectMap<References>,
>(database: Database): TypedDatabase<Models, Creates, Updates, References> {
  return database as unknown as TypedDatabase<Models, Creates, Updates, References>
}
