import type { IdentityFormat, ScalarFieldType } from './EntityDefinitions'
import type { FieldType } from './EntityDefinitions'

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
  /** Field name, in camelCase. */
  readonly field: string,
  /** Scalar field type. */
  readonly type: AuthoredScalar,
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
  /** Field name, in camelCase. */
  readonly field: string,
  /** Scalar array element descriptor. */
  readonly items: {
    /** Optional identity format for ID elements. */
    readonly format?: IdentityFormat,
    /** Scalar element type. */
    readonly type: Authored<ScalarFieldType>,
  },
  /** Array field type. */
  readonly type: Authored<FieldType.Array>,
}

/** One authored opaque JSON field. */
export interface AuthoredJSONField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** JSON field type. */
  readonly type: Authored<FieldType.JSON>,
}

/** One authored entity reference. */
export interface AuthoredReferenceField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** Optional inverse navigation name. */
  readonly inverse?: string,
  /** Referenced entity name. */
  readonly target: string,
  /** Entity reference field type. */
  readonly type: Authored<FieldType.Entity>,
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

/** One authored entity. */
export interface AuthoredEntity {
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
