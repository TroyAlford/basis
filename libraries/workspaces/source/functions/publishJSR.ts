/* eslint-disable no-console */
import { $ } from 'bun'
import { resolve } from 'node:path'
import type { LicenseOption } from '../types/LicenseOption'
import { findWorkspace } from './findWorkspace'
import { handleLicense } from './handleLicense'
import { listWorkspaces } from './listWorkspaces'
/** Options for publishing to JSR */
interface Options {
  /** License handling option */
  license?: LicenseOption,
  /** Package version to publish */
  version: string,
}

/**
 * Publishes packages to JSR
 * @param options - Publish options
 * @returns Array of published package names
 */
/** Options for publishing to JSR */
interface Options {
  /** Run in dry-run mode (no actual publishing) */
  dryRun?: boolean,
  /** License handling option */
  license?: LicenseOption,
  /** Patterns to exclude */
  not?: string[],
  /** Patterns to include */
  only?: string[],
  /** Package version to publish */
  version: string,
}

/**
 * Publishes packages to JSR
 * @param options - Publish options
 * @returns Array of published package names
 */
export async function publishJSR(options: Options) {
  const { dryRun = false, license = 'auto', not, only, version } = options
  const published: string[] = []
  const failed: string[] = []

  const workspaces = await listWorkspaces({ not, only })
  for (const name of workspaces) {
    try {
      console.log(`\nPreparing ${name} for JSR...`)

      const workspace = await findWorkspace(name)
      if (!workspace) {
        console.error(`Could not find workspace for package ${name}`)
        failed.push(name)
        continue
      }

      const { packageJson, packagePath } = workspace

      // Handle license
      await handleLicense(packagePath, license)

      const basisDependencies = Object.keys({
        ...packageJson.dependencies || {},
        ...packageJson.peerDependencies || {},
      }).reduce((all, dependency) => {
        if (!dependency?.startsWith('@basis/')) return all
        return all.set(dependency, version)
      }, new Map<string, string>())

      // Create JSR config
      const jsrConfig = {
        exports: packageJson.source || './index.ts',
        name: packageJson.name,
        peerDependencies: {
          ...packageJson.peerDependencies || {},
          ...Object.fromEntries(basisDependencies.entries()),
        },
        version,
      }

      // Write jsr.jsonc
      const jsrConfigPath = resolve(packagePath, 'jsr.jsonc')
      await Bun.write(
        jsrConfigPath,
        JSON.stringify(jsrConfig, null, 2),
      )

      // Publish to JSR
      if (dryRun) {
        console.log(`Would publish ${name} to JSR from ${packagePath}`)
      } else {
        console.log(`Publishing ${name} to JSR...`)
        // --allow-dirty is required, because we're updating but not committing jsr.jsonc
        const output = await $`bunx jsr publish --allow-dirty`.cwd(packagePath).nothrow()
        if (output.exitCode !== 0) {
          throw new Error(`Failed to publish ${name} to JSR: ${output.stderr}`)
        }
      }

      console.log(`✅ ${dryRun ? 'Prepared' : 'Published'} ${name}`)
      published.push(name)
    } catch (error) {
      console.error(`Failed to ${dryRun ? 'prepare' : 'publish'} ${name} for JSR:`, error)
      failed.push(name)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log(`JSR ${dryRun ? 'Dry Run' : 'Publish'} Summary:`)
  console.log('='.repeat(50))

  if (published.length > 0) {
    console.log(`\n✅ Successfully ${dryRun ? 'prepared' : 'published'}:`)
    published.forEach(name => console.log(`   ${name}`))
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed to ${dryRun ? 'prepare' : 'publish'}:`)
    failed.forEach(name => console.log(`   ${name}`))
    throw new Error(`Some packages failed to ${dryRun ? 'prepare for' : 'publish to'} JSR`)
  }

  return published
}
