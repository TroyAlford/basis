/**
 * Formats a number of bytes into a human-readable string
 * @param bytes - The number of bytes to format
 * @returns A human-readable string (e.g., "1.23 MB")
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1_024 && unitIndex < units.length - 1) {
    size /= 1_024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}
