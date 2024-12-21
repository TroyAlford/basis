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
      console.log(`Preparing ${name} for JSR...`)

      const workspace = await findWorkspace(name)
      if (!workspace) {
        console.error(`Could not find workspace for package ${name}`)
        failed.push(name)
        continue
      }

      const { packageJson, packagePath } = workspace
      await handleLicense(packagePath, license)

      // Separate @basis dependencies and handle versioning
      const dependencies: Record<string, string> = {}
      const peerDependencies: Record<string, string> = { ...packageJson.peerDependencies ?? {} }
      Object.keys(peerDependencies).forEach(dependency => {
        if (dependency.startsWith('@basis/')) {
          peerDependencies[dependency] = options.version
        }
      })
      Object.keys(packageJson.dependencies ?? {}).forEach(dependency => {
        if (dependency.startsWith('@basis/')) {
          peerDependencies[dependency] = options.version
        } else {
          dependencies[dependency] = packageJson.dependencies[dependency]
        }
      })

      /* eslint-disable sort-keys-fix/sort-keys-fix */
      const config: Record<string, unknown> = {
        name: packageJson.name,
        version,
        description: packageJson.description ?? undefined,
        exports: packageJson.source || './index.ts',
        dependencies: dependencies,
        peerDependencies: peerDependencies,
        publish: {
          exclude: [
            'package.json',
            '*.test.*',
            'dist',
          ],
        },
      }
      /* eslint-enable sort-keys-fix/sort-keys-fix */
      if (!packageJson.description) delete config.description
      if (!Object.keys(config.dependencies).length) delete config.dependencies
      if (!Object.keys(config.peerDependencies).length) delete config.peerDependencies

      // Write jsr.jsonc with comment header
      await Bun.write(resolve(packagePath, 'jsr.jsonc'), [
        '// This file is auto-generated. Do not edit directly.',
        JSON.stringify(config, null, 2),
      ].join('\n'))

      const flags = [
        '--allow-dirty',
        dryRun ? '--dry-run' : undefined,
      ].filter(Boolean).join(' ')

      console.log(`Publishing ${name} to JSR...`)
      const output = await $`bunx jsr publish ${flags}`.cwd(packagePath).nothrow()
      if (output.exitCode !== 0) {
        throw new Error(`Failed to publish ${name} to JSR: ${output.stderr}`)
      }

      console.log(`✅ ${dryRun ? 'Prepared' : 'Published'} ${name}`)
      published.push(name)
    } catch (error) {
      console.error(`Failed to ${dryRun ? 'prepare' : 'publish'} ${name} for JSR:`, error)
      failed.push(name)
    }
  }

  console.log(`JSR ${dryRun ? 'Dry Run' : 'Publish'} Summary:`)
  console.log('='.repeat(50))

  if (published.length > 0) {
    console.log(`✅ Successfully ${dryRun ? 'prepared' : 'published'}:`)
    published.forEach(name => console.log(`   ${name}`))
  }

  if (failed.length > 0) {
    console.log(`❌ Failed to ${dryRun ? 'prepare' : 'publish'}:`)
    failed.forEach(name => console.log(`   ${name}`))
    throw new Error(`Some packages failed to ${dryRun ? 'prepare for' : 'publish to'} JSR`)
  }

  return published
}
