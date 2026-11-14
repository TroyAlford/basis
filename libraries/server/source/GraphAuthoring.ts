import type { IdentityFormat, ScalarFieldType } from './EntityDefinitions'
import type { FieldType } from './EntityDefinitions'
import type { Constraint } from './EntityDefinitions'

/** Authored spelling of one canonical field kind. */
type Authored<T extends FieldType> = T | `${T}`
/** Authored scalar field kind. */
type AuthoredScalar = Authored<FieldType.Boolean | FieldType.Date | FieldType.Number>
  | Authored<FieldType.String | FieldType.Timestamp>
/** Authored inverse cardinality. */
type AuthoredCardinality = Cardinality | `${Cardinality}`

/** Navigation cardinality accepted by typed authoring. */
export enum Cardinality {
  /** A collection navigation. */
  Many = 'Many',
  /** A singular navigation. */
  One = 'One',
}

/** One authored scalar field. */
export interface AuthoredScalarField {
  /** Default value for the field. */
  readonly default?: unknown,
  /** Field name, in camelCase. */
  readonly field: string,
  /** Maximum length for String fields. */
  readonly maxLength?: number,
  /** Inclusive maximum for Number fields. */
  readonly maximum?: number,
  /** Minimum length for String fields. */
  readonly minLength?: number,
  /** Inclusive minimum for Number fields. */
  readonly minimum?: number,
  /** Whether the field accepts NULL; omitted means NOT NULL. */
  readonly nullable?: boolean,
  /** Scalar field type. */
  readonly type: AuthoredScalar,
  /** Whether the field requires uniqueness. */
  readonly unique?: true,
}

/** One authored `id` refinement. */
export interface AuthoredIdentityField {
  /** Universal identity field. */
  readonly field: 'id',
  /** Optional canonical identity format. */
  readonly format?: IdentityFormat,
}

/** One authored native array field. */
export interface AuthoredArrayField {
  /** Default array value for the field. */
  readonly default?: readonly unknown[],
  /** Field name, in camelCase. */
  readonly field: string,
  /** Scalar array element descriptor. */
  readonly items: {
    /** Optional identity format for ID elements. */
    readonly format?: IdentityFormat,
    /** Scalar element type. */
    readonly type: Authored<ScalarFieldType>,
  },
  /** Whether the field accepts NULL; omitted means NOT NULL. */
  readonly nullable?: boolean,
  /** Array field type. */
  readonly type: Authored<FieldType.Array>,
  /** Whether the field requires uniqueness. */
  readonly unique?: true,
}

/** One authored opaque JSON field. */
export interface AuthoredJSONField {
  /** Default JSON value for the field. */
  readonly default?: unknown,
  /** Field name, in camelCase. */
  readonly field: string,
  /** Whether the field accepts NULL; omitted means NOT NULL. */
  readonly nullable?: boolean,
  /** JSON field type. */
  readonly type: Authored<FieldType.JSON>,
  /** Whether the field requires uniqueness. */
  readonly unique?: true,
}

/** One authored entity reference. */
export interface AuthoredReferenceField {
  /** Default referenced identity for the field. */
  readonly default?: string,
  /** Field name, in camelCase. */
  readonly field: string,
  /** Optional inverse navigation name. */
  readonly inverse?: string,
  /** Whether the reference accepts NULL; omitted preserves optional-reference behavior. */
  readonly nullable?: boolean,
  /** Referenced entity name. */
  readonly target: string,
  /** Entity reference field type. */
  readonly type: Authored<FieldType.Entity>,
  /** Whether the field requires uniqueness. */
  readonly unique?: true,
}

/** One authored reciprocal inverse navigation. */
export interface AuthoredInverseField {
  /** Inverse cardinality. */
  readonly cardinality: AuthoredCardinality,
  /** Field name, in camelCase. */
  readonly field: string,
  /** Forward reference field name. */
  readonly inverse: string,
  /** Entity exposing the forward reference. */
  readonly target: string,
  /** Inverse navigation field type. */
  readonly type: Authored<FieldType.Inverse>,
}

/** Any authored entity field. */
export type AuthoredField =
  | AuthoredArrayField
  | AuthoredIdentityField
  | AuthoredInverseField
  | AuthoredJSONField
  | AuthoredReferenceField
  | AuthoredScalarField

/** One authored uniqueness constraint. */
export interface AuthoredUniquenessConstraint {
  /** Human-readable diagnostic description. */
  readonly description: string,
  /** Canonical logical fields covered by the constraint. */
  readonly fields: readonly string[],
  /** Human-readable constraint name. */
  readonly name: string,
  /** Constraint discriminator. */
  readonly type: Constraint.Uniqueness,
}

/** One authored declarative constraint. */
export type AuthoredConstraint = AuthoredUniquenessConstraint

/** One authored entity. */
export interface AuthoredEntity {
  /** Declarative constraints owned by this entity. */
  readonly constraints?: readonly AuthoredConstraint[],
  /** Parent entity, when using MTI. */
  readonly extends?: string,
  /** Declared local fields. */
  readonly fields: readonly AuthoredField[],
  /** Exact entity name. */
  readonly name: string,
}

/** One authored relationship endpoint. */
export interface AuthoredRelationshipEndpoint {
  /** Endpoint field name, in camelCase. */
  readonly field: string,
  /** Inverse navigation name on the target. */
  readonly inverse: string,
  /** Referenced entity name. */
  readonly target: string,
}

/** One authored named relationship. */
export interface AuthoredRelationship {
  /** The two relationship endpoints. */
  readonly between: readonly [AuthoredRelationshipEndpoint, AuthoredRelationshipEndpoint],
  /** Declarative constraints owned by this relationship. */
  readonly constraints?: readonly AuthoredConstraint[],
  /** Relationship-owned fields. */
  readonly fields: readonly (AuthoredArrayField | AuthoredJSONField | AuthoredScalarField)[],
  /** Relationship name. */
  readonly name: string,
}

/** JSON-compatible typed authoring document. */
export interface AuthoredDocument {
  /** Entity declarations. */
  readonly entities: readonly AuthoredEntity[],
  /** Named relationship declarations. */
  readonly relationships?: readonly AuthoredRelationship[],
}
