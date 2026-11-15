/* eslint-disable @stylistic/jsx/indent, @stylistic/ts/indent */
import type { PathOf, TypeAt } from 'basis/utilities'
import type { TransactionSQL } from 'bun'
import type { Database, QueryOptions } from '../source/Database'
import type { CreateResult, DeleteResult, EditResult, MutationFilter, MutationRecord, UpsertResult } from '../source/Mutation'

/** A generated entity-name to hydrated-interface map. */
export type EntityModels = object
/** A generated entity-name to mutation-field contract map. */
export type MutationModels = object
/** A generated entity-name to reference-target map. */
export type ReferenceModels = object
/** Constraint preserving a map's generated keys while requiring object values. */
type ObjectMap<Map> = { [Key in keyof Map]: object }

/** Constraint preserving mutation-map keys while requiring mutation contracts. */
type MutationMapConstraint<Map> = { [Key in keyof Map]: MutationContract }

/** One generated mutation field contract for an entity. */
export interface MutationContract {
  /** Whether the entity can be created or upserted. */
  readonly creatable: boolean,
  /** Fields accepted by create, including optional identity. */
  readonly create: string,
  /** Fields required by create. */
  readonly required: string,
  /** Fields accepted by edit. */
  readonly writable: string,
}

/** Convert one hydrated field type into its mutation input type. */
type MutationValue<Value> = NonNullable<Value> extends {
  readonly entity: unknown,
  readonly id: string,
  readonly name: string,
} ? string | (null extends Value ? null : never) : Value

/** Typed create input derived from one hydrated entity and its field contract. */
export type CreateInput<
  Model extends object,
  Contract extends MutationContract,
> = {
  readonly [Field in Contract['required'] & keyof Model]: MutationValue<Model[Field]>
} & {
  readonly [Field in Exclude<Contract['create'], Contract['required']> & keyof Model]?:
  MutationValue<Model[Field]>
}

/** Typed edit input derived from one hydrated entity and its writable fields. */
export type EditInput<
  Model extends object,
  Contract extends MutationContract,
> = {
  readonly [Field in Contract['writable'] & keyof Model]?: MutationValue<Model[Field]>
}

/** Entity names that permit create/upsert. */
export type MutationCreatableNames<Mutations extends object> = {
  [Name in keyof Mutations]: Mutations[Name] extends { readonly creatable: true } ? Name : never
}[keyof Mutations]

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

/**
 * Reference-target paths for one entity, bounded against cyclic models.
 * The root PathOf already contributes the first reference hop, so seven
 * recursive expansions complete the canonical eight-hop query depth.
 */
type ReferencePaths<
  Models extends ObjectMap<Models>,
  References extends ObjectMap<References>,
  Name extends keyof Models & string,
  Depth extends readonly unknown[] = [],
> = Depth['length'] extends 7
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

/** Typed mutation and query operations shared by the database and transaction facades. */
interface TypedOperations<
  Models extends ObjectMap<Models>,
  Mutations extends MutationMapConstraint<Mutations>,
  References extends ObjectMap<References>,
> {
  /**
   * Create one typed entity.
   * @param entity - Generated concrete entity name.
   * @param values - Typed create payload.
   * @returns The created count and hydrated record.
   */
  create<Name extends keyof Models & MutationCreatableNames<Mutations> & string>(
    entity: Name,
    values: CreateInput<Models[Name], Mutations[Name]>,
  ): Promise<CreateResult<Models[Name] & MutationRecord>>,
  /**
   * Create a typed entity batch.
   * @param entity - Generated concrete entity name.
   * @param values - Typed create payload iterable.
   * @returns The created count.
   */
  create<Name extends keyof Models & MutationCreatableNames<Mutations> & string>(
    entity: Name,
    values: Iterable<CreateInput<Models[Name], Mutations[Name]>>,
  ): Promise<CreateResult>,
  /**
   * Delete one typed entity set.
   * @param entity - Generated entity name.
   * @param filter - Canonical mutation filter.
   * @returns The deleted count.
   */
  delete<Name extends keyof Models & string>(
    entity: Name,
    filter: MutationFilter,
  ): Promise<DeleteResult>,
  /**
   * Edit one typed entity set.
   * @param entity - Generated entity name.
   * @param filter - Canonical mutation filter.
   * @param changes - Typed update payload.
   * @returns The edited count and an optional hydrated record.
   */
  edit<Name extends keyof Models & keyof Mutations & string>(
    entity: Name,
    filter: MutationFilter,
    changes: EditInput<Models[Name], Mutations[Name]>,
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
   * Upsert one typed concrete entity.
   * @param entity - Generated concrete entity name.
   * @param filter - Canonical mutation filter.
   * @param values - Typed update/create payload.
   * @returns The branch counts and hydrated record.
   */
  upsert<Name extends keyof Models & MutationCreatableNames<Mutations> & string>(
    entity: Name,
    filter: MutationFilter,
    values: CreateInput<Models[Name], Mutations[Name]> | EditInput<Models[Name], Mutations[Name]>,
  ): Promise<UpsertResult<Models[Name] & MutationRecord>>,
}

/** A transaction client with typed mutation operations. */
export type TypedDatabaseTransaction<
  Models extends ObjectMap<Models>,
  Mutations extends MutationMapConstraint<Mutations>,
  References extends ObjectMap<References>,
> = TransactionSQL & Omit<TypedOperations<Models, Mutations, References>, 'query'>

/** A database facade bound to generated entity and mutation maps. */
export type TypedDatabase<
  Models extends ObjectMap<Models>,
  Mutations extends MutationMapConstraint<Mutations>,
  References extends ObjectMap<References>,
> = Omit<Database, 'create' | 'delete' | 'edit' | 'query' | 'tx' | 'upsert'>
  & TypedOperations<Models, Mutations, References> & {
    /**
     * Run one native Bun transaction with typed mutation verbs.
     * @param callback - Transaction-scoped typed work.
     * @returns The callback result after commit.
     */
    tx<T>(
      callback: (
        transaction: TypedDatabaseTransaction<Models, Mutations, References>,
      ) => T | Promise<T>,
    ): Promise<Awaited<T>>,
  }

/**
 * Bind an existing database to generated entity maps.
 * @param database - Server database capability.
 * @returns The typed facade over the same database.
 */
export function typedDatabase<
  Models extends ObjectMap<Models>,
  Mutations extends MutationMapConstraint<Mutations>,
  References extends ObjectMap<References>,
>(database: Database): TypedDatabase<Models, Mutations, References> {
  return database as unknown as TypedDatabase<Models, Mutations, References>
}
