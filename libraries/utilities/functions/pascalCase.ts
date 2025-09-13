import { deburr } from './deburr'

/**
 * Converts a string to PascalCase
 * @param input The string to convert
 * @returns The PascalCase string
 */
export const pascalCase = (input: string): string => deburr(input)
  .replace(/(?:^|[\s\-_]+)([a-z])/g, (_, char) => char.toUpperCase())
  .replace(/[\s\-_]/g, '')
