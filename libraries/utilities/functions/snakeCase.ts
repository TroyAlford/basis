import { deburr } from './deburr'

/**
 * Converts a string to snake_case.
 * @param input the string to convert
 * @returns the snake_case string
 */
export const snakeCase = (input: string): string => deburr(input)
  .replace(/([^\w]|[\s-])+/g, '_') // Replace non-word characters with underscores
  .replace(/([a-z])([A-Z])/g, '$1_$2') // Insert underscores between camelCase words
  .replace(/_{2,}/g, '_') // Collapse repeated underscores
  .replace(/^_+|_+$/g, '') // Trim leading/trailing underscores
  .toLowerCase() // Convert to lowercase
