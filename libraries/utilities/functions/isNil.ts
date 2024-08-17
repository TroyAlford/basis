export const isNil = (value: unknown): boolean => (
  value === null || value === undefined || Number.isNaN(value)
)
