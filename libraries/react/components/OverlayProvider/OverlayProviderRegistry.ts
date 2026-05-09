let nextId = 0

export const overlayProviderRequiredMessage = [
  'OverlayProvider is not mounted.',
  'Render <OverlayProvider /> inside your React application tree before using Dialog.open() or Toast.create().',
].join(' ')

/**
 * Builds a stable unique id for overlay entries.
 * @param prefix - Short label prefix (for example `dialog` or `toast`).
 * @returns A string id unique for this process.
 */
export function createOverlayId(prefix: string): string {
  return `${prefix}-${++nextId}`
}
