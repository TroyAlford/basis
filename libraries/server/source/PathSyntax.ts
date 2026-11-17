import type { OrderBy } from './SQL'

/** Parsed collection-context directives on one path segment. */
export interface CollectionDirectives {
  /** Collection filter, relative to each item. */
  readonly filter?: string,
  /** Requested page size; `null` means unlimited. */
  readonly limit?: number | null,
  /** Base collection field name. */
  readonly name: string,
  /** Requested page offset. */
  readonly offset?: number,
  /** Requested item ordering. */
  readonly orderBy?: OrderBy,
}

/**
 * Split a string on one delimiter outside brackets, braces and quoted strings.
 * @param value - Source text.
 * @param delimiter - Delimiter character.
 * @returns Trimmed, non-empty pieces.
 */
function splitTopLevel(value: string, delimiter: string): readonly string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quoteCharacter: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (quoteCharacter !== null) {
      current += character
      if (character === '\\') {
        index += 1
        current += value[index] ?? ''
      } else if (character === quoteCharacter) {
        quoteCharacter = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quoteCharacter = character
      current += character
      continue
    }
    if (character === '[' || character === '{') {
      depth += 1
      current += character
      continue
    }
    if (character === ']' || character === '}') {
      depth -= 1
      current += character
      continue
    }
    if (character === delimiter && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (quoteCharacter !== null || depth !== 0) throw new Error(`Unbalanced collection directive "${value}"`)
  parts.push(current.trim())
  return parts.filter(part => part !== '')
}

/**
 * Read one balanced bracket or brace group.
 * @param segment - Full path segment.
 * @param start - Opening delimiter index.
 * @param open - Opening delimiter.
 * @param close - Closing delimiter.
 * @returns The content and the index just after the group.
 */
function readGroup(
  segment: string,
  start: number,
  open: string,
  close: string,
): { readonly content: string, readonly next: number } {
  let depth = 1
  let quoteCharacter: string | null = null
  let content = ''
  let index = start + 1
  for (; index < segment.length && depth > 0; index += 1) {
    const character = segment[index] as string
    if (quoteCharacter !== null) {
      content += character
      if (character === '\\') {
        index += 1
        content += segment[index] ?? ''
      } else if (character === quoteCharacter) {
        quoteCharacter = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quoteCharacter = character
      content += character
      continue
    }
    if (character === open) {
      depth += 1
      content += character
      continue
    }
    if (character === close) {
      depth -= 1
      if (depth === 0) break
      content += character
      continue
    }
    if (character === '[' || character === '{') {
      depth += 1
      content += character
      continue
    }
    if (character === ']' || character === '}') {
      depth -= 1
      content += character
      continue
    }
    content += character
  }
  if (depth !== 0 || quoteCharacter !== null) throw new Error(`Unbalanced collection path "${segment}"`)
  return { content: content.trim(), next: index + 1 }
}

/**
 * Parse one compact `$orderBy` value.
 * @param value - Option value.
 * @returns Existing orderBy contract values.
 */
function parseOrderByValue(value: string): OrderBy {
  if (value.startsWith('[') && value.endsWith(']')) {
    const fields = splitTopLevel(value.slice(1, -1), ',')
    if (fields.length === 0) throw new Error('Collection $orderBy array must not be empty')
    return fields.map(field => parseOrderByField(field)) as readonly string[]
  }
  return parseOrderByField(value)
}

/**
 * Parse one short orderBy field.
 * @param value - Field text.
 * @returns Field or `-field` shorthand.
 */
function parseOrderByField(value: string): string {
  const field = value.trim()
  if (field === '') throw new Error('Collection $orderBy field must not be empty')
  if (field.startsWith('--')) throw new Error('Collection $orderBy uses one leading "-" for descending')
  return field
}

/**
 * Parse one compact options group.
 * @param content - Group content.
 * @returns Parsed options.
 */
function parseCollectionOptions(content: string): Pick<CollectionDirectives, 'limit' | 'offset' | 'orderBy'> {
  const options: { limit?: number | null, offset?: number, orderBy?: OrderBy } = {}
  const seen = new Set<string>()
  for (const entry of splitTopLevel(content, ',')) {
    const separator = entry.indexOf(':')
    if (separator === -1) throw new Error(`Collection option "${entry}" must be a key:value pair`)
    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()
    if (seen.has(key)) throw new Error(`Collection option "${key}" is repeated`)
    seen.add(key)
    if (key === '$limit') {
      if (value === 'null') {
        options.limit = null
      } else if (/^\d+$/u.test(value)) {
        options.limit = Number(value)
      } else {
        throw new Error('Collection $limit must be a non-negative integer or null')
      }
    } else if (key === '$offset') {
      if (!/^\d+$/u.test(value)) throw new Error('Collection $offset must be a non-negative integer')
      options.offset = Number(value)
    } else if (key === '$orderBy') {
      options.orderBy = parseOrderByValue(value)
    } else {
      throw new Error(`Unknown collection option "${key}"`)
    }
  }
  return options
}

/**
 * Split one field path without splitting dots inside directive groups or quoted strings.
 * @param value - Requested field path.
 * @returns Path segments.
 */
export function splitFieldPath(value: string): readonly string[] {
  const segments: string[] = []
  let current = ''
  let depth = 0
  let quoteCharacter: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (quoteCharacter !== null) {
      current += character
      if (character === '\\') {
        index += 1
        current += value[index] ?? ''
      } else if (character === quoteCharacter) {
        quoteCharacter = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quoteCharacter = character
      current += character
      continue
    }
    if (character === '[' || character === '{') {
      depth += 1
      current += character
      continue
    }
    if (character === ']' || character === '}') {
      depth -= 1
      current += character
      continue
    }
    if (character === '.' && depth === 0) {
      segments.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (quoteCharacter !== null || depth !== 0) throw new Error(`Unbalanced collection path "${value}"`)
  segments.push(current)
  return segments
}

/**
 * Parse collection filter, options and `$orderBy` from one path segment.
 * Filter group `[...]` must precede options group `{...}`.
 * @param segment - One requested field-path segment.
 * @returns The base name and its directives.
 */
export function parseCollectionDirectives(segment: string): CollectionDirectives {
  const bracket = segment.indexOf('[')
  const brace = segment.indexOf('{')
  const open = bracket === -1 ? brace : brace === -1 ? bracket : Math.min(bracket, brace)
  if (open === -1) return { name: segment }
  const name = segment.slice(0, open)
  if (name === '') throw new Error(`Collection path "${segment}" has no field name`)
  let index = open
  let filter: string | undefined
  let options: Pick<CollectionDirectives, 'limit' | 'offset' | 'orderBy'> = {}
  if (segment[index] === '[') {
    const group = readGroup(segment, index, '[', ']')
    filter = group.content
    if (filter === '') throw new Error(`Collection filter in "${segment}" is empty`)
    index = group.next
  }
  if (segment[index] === '{') {
    const group = readGroup(segment, index, '{', '}')
    options = parseCollectionOptions(group.content)
    index = group.next
  } else if (segment[index] === '[') {
    throw new Error(`Collection filters must be specified once in "${segment}"`)
  }
  if (index !== segment.length) {
    throw new Error(`Collection options must precede filters and appear once in "${segment}"`)
  }
  return { filter, name, ...options }
}
