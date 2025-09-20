import { deburr } from './deburr'

/**
 * Converts a string to title case.
 * @param input The string to convert.
 * @returns The title-cased string.
 * @example
 * ```ts
 * titleCase('hello world') // 'Hello World'
 * titleCase('hello-world') // 'Hello World'
 * titleCase('hello_world') // 'Hello World'
 * titleCase('helloWorld') // 'Hello World'
 * ```
 */
export const titleCase = (input: string): string => {
  if (!input) return input

  return deburr(input)
    // Insert spaces before capital letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Replace separators with spaces
    .replace(/[-_\s]+/g, ' ')
    // Capitalize first letter of each word
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .trim()
}
