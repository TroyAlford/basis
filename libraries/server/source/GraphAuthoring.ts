import type { IdentityFormat, ScalarFieldType } from './EntityDefinitions'
import type { FieldType } from './EntityDefinitions'
import type { Constraint } from './EntityDefinitions'
import type { Action, Security } from './Graph'
import type { Filter } from './Predicate'

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

/** One authored named enum mapping persisted values to descriptions. */
export type AuthoredEnum = Readonly<Record<string, string>>

/** Authored named enums keyed by exact enum name. */
export type AuthoredEnumSource = Readonly<Record<string, AuthoredEnum>>

/** One authored named enum field. */
export interface AuthoredEnumField {
  /** Default persisted value. */
  readonly default?: string,
  /** Referenced Graph enum name. */
  readonly enum: string,
  /** Field name, in camelCase. */
  readonly field: string,
  /** Whether the field accepts NULL; omitted means NOT NULL. */
  readonly nullable?: boolean,
  /** Enum field type. */
  readonly type: Authored<FieldType.Enum>,
  /** Whether the field requires uniqueness. */
  readonly unique?: true,
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

/** One authored derived collection navigation. */
export interface AuthoredCollectionField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** Entity or relationship record type returned by the collection. */
  readonly target: string,
  /** Collection field type. */
  readonly type: Authored<FieldType.Collection>,
  /** Owner-relative Graph path used to resolve the collection. */
  readonly via: string,
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
  | AuthoredCollectionField
  | AuthoredEnumField
  | AuthoredIdentityField
  | AuthoredInverseField
  | AuthoredJSONField
  | AuthoredReferenceField
  | AuthoredScalarField

/** One authored structural constraint. */
export interface StructuralConstraint {
  /** Human-readable diagnostic description. */
  readonly description: string,
  /** Canonical logical fields covered by the constraint. */
  readonly fields: readonly string[],
  /** Human-readable constraint name. */
  readonly name: string,
  /** Constraint discriminator. */
  readonly type: Constraint.Structural,
}

/** One authored positive valid-state constraint. */
export interface ValidationConstraint {
  /** Human-readable diagnostic description. */
  readonly description: string,
  /** Human-readable constraint name. */
  readonly name: string,
  /** Constraint discriminator. */
  readonly type: Constraint.Validation,
  /** Positive valid-state predicate normalized by the canonical predicate engine. */
  readonly where: Filter | string,
}

/** One authored declarative constraint. */
export type GraphConstraint = StructuralConstraint | ValidationConstraint

/** One authored entity security rule. */
export interface AuthoredSecurityRule {
  /** Named reusable capability required by this rule. */
  readonly grant?: string,
  /** Graph role required by this rule. */
  readonly role?: string,
  /** Row predicate normalized by the canonical Predicate/QueryNormalizer path. */
  readonly where?: Filter | Readonly<Record<string, unknown>> | string | null,
}

/** Entity or relationship security keyed by the closed action vocabulary. */
export type AuthoredSecurity = Partial<Record<
  Action,
  Security | AuthoredSecurityRule | readonly AuthoredSecurityRule[]
>>

/** One authored entity. */
export interface AuthoredEntity {
  /** Declarative constraints owned by this entity. */
  readonly constraints?: readonly GraphConstraint[],
  /** Parent entity, when using MTI. */
  readonly extends?: string,
  /** Declared local fields. */
  readonly fields: readonly AuthoredField[],
  /** Exact entity name. */
  readonly name: string,
  /** Action-keyed security declaration owned by this entity. */
  readonly security?: AuthoredSecurity,
}

/** One authored relationship endpoint. */
export interface AuthoredRelationshipEndpoint {
  /** Endpoint field name, in camelCase. */
  readonly field: string,
  /** Referenced entity name. */
  readonly target: string,
}

/** One authored named relationship. */
export interface AuthoredRelationship {
  /** The relationship endpoints in authored order. */
  readonly between: readonly AuthoredRelationshipEndpoint[],
  /** Declarative constraints owned by this relationship. */
  readonly constraints?: readonly GraphConstraint[],
  /** Relationship-owned fields. */
  readonly fields: readonly (AuthoredArrayField | AuthoredEnumField | AuthoredJSONField | AuthoredScalarField)[],
  /** Relationship name. */
  readonly name: string,
  /** Action-keyed security declaration owned by this relationship. */
  readonly security?: AuthoredSecurity,
}

/** JSON-compatible typed authoring document. */
export interface AuthoredDocument {
  /** Entity declarations. */
  readonly entities: readonly AuthoredEntity[],
  /** Named reusable enum declarations keyed by exact name. */
  readonly enums?: AuthoredEnumSource,
  /** Named relationship declarations. */
  readonly relationships?: readonly AuthoredRelationship[],
}
