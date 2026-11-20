/** The vendor specifiers discovered by the active Basis Server build. */
let active: Promise<ReadonlySet<string>> | null = null

/**
 * Register the vendor discovery for the active application build.
 * @param specifiers - The pending discovered specifier set, or null to clear it.
 */
export function setVendorSpecifiers(specifiers: Promise<ReadonlySet<string>> | null): void {
  active = specifiers
}

/**
 * Read the vendor specifiers for the active application build.
 * @returns The discovered specifiers, or null when no Server owns the build.
 */
export async function vendorSpecifiers(): Promise<ReadonlySet<string> | null> {
  if (!active) return null
  try {
    return await active
  } catch {
    return null
  }
}
