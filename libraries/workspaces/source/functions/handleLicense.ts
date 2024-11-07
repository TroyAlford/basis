import { resolve } from 'path'
import type { LicenseOption } from '../types/LicenseOption'

/**
 * Handles the license file for a package.
 * @param packagePath - The path to the package.
 * @param licenseOption - The license option.
 * @returns The path to the license file.
 */
export async function handleLicense(packagePath: string, licenseOption: LicenseOption): Promise<string | null> {
  if (licenseOption === 'none') {
    return null
  }

  const workspaceLicense = resolve(packagePath, 'LICENSE')
  const rootLicense = resolve(process.cwd(), 'LICENSE')

  // Check workspace first for 'auto'
  if (licenseOption === 'auto' && await Bun.file(workspaceLicense).exists()) {
    return 'LICENSE'
  }

  // For both 'inherit' and 'auto' (when no local license exists)
  if (await Bun.file(rootLicense).exists()) {
    await Bun.write(workspaceLicense, await Bun.file(rootLicense).text())
    return 'LICENSE'
  }

  throw new Error('No LICENSE file found in repository root')
}
