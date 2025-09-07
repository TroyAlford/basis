import { hash } from './hash'

/**
 * Generate a random hash
 * @returns A random hash string
 */
export const randomHash = (): string => (
  hash(Math.random().toString()).replace(/-/g, '')
)
