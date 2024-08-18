/**
 * Remove diacritical marks from a string.
 * @param input the string to remove diacritical marks from
 * @returns the string without diacritical marks
 * @example deburr('déjà vu') // returns 'deja vu'
 */
export const deburr = (input: string): string => input
  .normalize('NFD') // decompose diacriticals into separate characters
  .replace(/[\u0300-\u036f]/g, '') // remove all diacritical characters
