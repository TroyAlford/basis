import type { Rule } from 'eslint'

/** Options accepted by a rule. */
type RuleOptions = readonly unknown[]

/** The shape accepted by a rule creator. */
interface RuleDefinition {
  /** The rule implementation. */
  create: (context: Rule.RuleContext, optionsWithDefault: RuleOptions) => Rule.RuleListener,
  /** Deprecated default options kept for compatibility. */
  defaultOptions?: RuleOptions,
  /** The rule metadata. */
  meta: Rule.RuleMetaData,
  /** The rule name. */
  name: string,
}

/**
 * Whether a value is a plain object.
 * @param value - The value to test.
 * @returns Whether the value is a plain object.
 */
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

/**
 * Merges a user option over its default without mutating either value.
 * @param fallback - The default option.
 * @param override - The user option.
 * @returns The merged option.
 */
const mergeOption = (fallback: unknown, override: unknown): unknown => {
  if (isObject(fallback) && isObject(override)) {
    const merged: Record<string, unknown> = { ...fallback }
    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in fallback ? mergeOption(fallback[key], value) : value
    }
    return merged
  }
  return override
}

/**
 * Applies rule defaults to the options supplied by a consumer.
 * @param defaults - The rule's default options.
 * @param options - The options supplied by the consumer.
 * @returns The options with defaults applied.
 */
const applyDefault = (defaults: RuleOptions, options: RuleOptions): RuleOptions => {
  const merged = structuredClone(defaults) as unknown[]
  options.forEach((option, index) => {
    if (option !== undefined) merged[index] = mergeOption(merged[index], option)
  })
  return merged
}

/**
 * Creates a rule with default options and a documentation URL.
 * @param definition - The rule definition.
 * @returns The rule module.
 */
const createRule = (definition: RuleDefinition): Rule.RuleModule => {
  const { create, defaultOptions, meta } = definition
  const resolvedDefaults = meta.defaultOptions ?? defaultOptions ?? []
  return {
    create(context: Rule.RuleContext): Rule.RuleListener {
      return create(context, applyDefault(resolvedDefaults, context.options))
    },
    meta,
  }
}

/**
 * Creates a named rule that publishes a documentation URL.
 * @param urlCreator - Builds the documentation URL for a rule name.
 * @returns A rule creator.
 */
export const RuleCreator = (urlCreator: (name: string) => string) => (
  (definition: RuleDefinition): Rule.RuleModule => createRule({
    ...definition,
    meta: {
      ...definition.meta,
      docs: {
        ...definition.meta.docs,
        url: urlCreator(definition.name),
      },
    },
  })
)

RuleCreator.withoutDocs = createRule
