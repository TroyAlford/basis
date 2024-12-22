/* eslint-disable no-console */
import { $ } from 'bun'
import { resolve } from 'node:path'
import type { LicenseOption } from '../types/LicenseOption'
import { findWorkspace } from './findWorkspace'
import { handleLicense } from './handleLicense'
import { listWorkspaces } from './listWorkspaces'

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
 * Get the latest published version of a package on JSR
 * @param packageName - The package name (e.g. "@basis/utilities")
 * @param fallbackVersion - Version to use if package is not published
 * @returns The latest version or fallback version
 */
async function getLatestPublishedVersion(packageName: string, fallbackVersion: string): Promise<string> {
  try {
    const response = await fetch(`https://jsr.io/${packageName}/meta.json`)
    if (!response.ok) { return fallbackVersion }
    const data = await response.json()
    return data.latest || fallbackVersion
  } catch {
    // If the package isn't published yet or request fails, return the fallback version
    return fallbackVersion
  }
}

/**
 * Sort workspaces by dependency order (dependencies before dependents)
 * @param workspaces - Array of workspace names
 * @returns Sorted array of workspace names
 */
async function sortByDependencyOrder(workspaces: string[]): Promise<string[]> {
  const dependencyGraph = new Map<string, Set<string>>()
  const workspaceInfos = new Map<string, {
    packageJson: {
      dependencies?: Record<string, string>,
      peerDependencies?: Record<string, string>,
    },
    packagePath: string,
  }>()

  // Build dependency graph
  for (const name of workspaces) {
    const workspace = await findWorkspace(name)
    if (!workspace) continue

    workspaceInfos.set(name, workspace)
    const deps = new Set<string>()
    const { dependencies = {}, peerDependencies = {} } = workspace.packageJson

    // Add all @basis dependencies
    Object.keys({ ...dependencies, ...peerDependencies })
      .filter(dep => dep.startsWith('@basis/'))
      .forEach(dep => deps.add(dep))

    dependencyGraph.set(name, deps)
  }

  // Topological sort
  const sorted: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  /**
   * Visit a workspace and its dependencies
   * @param name - The workspace name
   */
  function visit(name: string) {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`)
    }

    visiting.add(name)
    const deps = dependencyGraph.get(name) || new Set()
    for (const dep of deps) {
      if (workspaces.includes(dep)) { visit(dep) }
    }
    visiting.delete(name)
    visited.add(name)
    sorted.push(name)
  }

  // Sort all workspaces
  workspaces.forEach(name => {
    if (!visited.has(name)) visit(name)
  })

  return sorted
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
  const skipped: string[] = []

  // Get all workspaces and sort them by dependency order
  const workspaces = await listWorkspaces({ not, only })
  const sortedWorkspaces = await sortByDependencyOrder(workspaces)

  // Track published versions for dependency resolution
  const publishedVersions = new Map<string, string>()

  for (const name of sortedWorkspaces) {
    try {
      console.log(`Preparing ${name} for JSR...`)

      const workspace = await findWorkspace(name)
      if (!workspace) {
        console.error(`Could not find workspace for package ${name}`)
        failed.push(name)
        continue
      }

      const { packageJson, packagePath } = workspace

      if (packageJson.scripts?.publish === 'SKIP') {
        console.log(`Skipping ${name} due to "publish" script set to "SKIP"`)
        skipped.push(name)
        continue
      }

      await handleLicense(packagePath, license)

      // Handle dependencies and versioning
      const imports: Record<string, string> = {}

      // Process all dependencies (both regular and peer)
      const allDependencies = {
        ...packageJson.dependencies ?? {},
        ...packageJson.peerDependencies ?? {},
      }

      for (const [dependency, originalVersion] of Object.entries(allDependencies)) {
        if (dependency.startsWith('@basis/')) {
          // If the dependency was just published, use that version
          const publishedVersion = publishedVersions.get(dependency)
          const targetVersion = publishedVersion || await getLatestPublishedVersion(dependency, version)
          // Format as JSR dependency
          imports[dependency] = `jsr:${dependency}@${targetVersion}`
        } else {
          // For non-@basis dependencies, use npm format with npm: prefix
          imports[dependency] = `npm:${dependency}@${originalVersion}`
        }
      }

      /* eslint-disable sort-keys-fix/sort-keys-fix */
      const config: Record<string, unknown> = {
        name: packageJson.name,
        version,
        description: packageJson.description ?? undefined,
        exports: packageJson.exports || packageJson.source || './index.ts',
        imports,
        publish: {
          exclude: ['package.json', '*.test.*'],
        },
      }
      /* eslint-enable sort-keys-fix/sort-keys-fix */
      if (!packageJson.description) delete config.description
      if (!Object.keys(imports).length) delete config.imports

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

      // Track the published version
      publishedVersions.set(name, version)

      console.log(`✅ ${dryRun ? 'Prepared' : 'Published'} ${name}`)
      published.push(name)
    } catch (error) {
      console.error(`Failed to ${dryRun ? 'prepare' : 'publish'} ${name} for JSR:`, error)
      failed.push(name)
    }
  }

  // Output summary
  console.log(`\nJSR ${dryRun ? 'Dry Run' : 'Publish'} Summary:`)
  console.log('='.repeat(50))

  if (published.length > 0) {
    console.log(`✅ Successfully ${dryRun ? 'prepared' : 'published'}:`)
    published.forEach(name => console.log(`   ${name}`))
  }

  if (skipped.length > 0) {
    console.log('🙈 Skipped packages:')
    skipped.forEach(name => console.log(`   ${name}`))
  }

  if (failed.length > 0) {
    console.log(`❌ Failed to ${dryRun ? 'prepare' : 'publish'}:`)
    failed.forEach(name => console.log(`   ${name}`))
    throw new Error(`Some packages failed to ${dryRun ? 'prepare for' : 'publish to'} JSR`)
  }

  return published
}
