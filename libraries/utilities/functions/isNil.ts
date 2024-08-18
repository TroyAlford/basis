/**
 * Check if a value is null, undefined or NaN
 * @param value the value to check
 * @returns true if the value is null, undefined or NaN
 */
export const isNil = (value: unknown): boolean => value === null || value === undefined || Number.isNaN(value)
