#!/usr/bin/env bun
/* eslint-disable no-console */
import { parseArgs } from 'node:util'
import { buildPackage } from '../functions/buildPackage'
import { findWorkspace } from '../functions/findWorkspace'
import { getAllWorkspaces } from '../functions/getAllWorkspaces'
import { getChangedFiles } from '../functions/getChangedFiles'
import { getChangedWorkspaces } from '../functions/getChangedWorkspaces'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  args: Bun.argv.slice(2),
  options: {
    license: { default: 'none', type: 'string' },
    not: { default: [], multiple: true, type: 'string' },
    only: { default: [], multiple: true, type: 'string' },
    outdir: { default: 'dist', short: 'o', type: 'string' },
    version: { short: 'v', type: 'string' },
  },
})

const [command, packageName] = positionals

if (!command) {
  console.error('Usage: workspace <command> [package] [options]')
  process.exit(1)
}

/**
 * Filters an array of items by the patterns provided in the `only` and `not` options.
 * @param items - The array of items to filter.
 * @returns The filtered array of items.
 */
function filterByPatterns(items: string[]): string[] {
  let filtered = items

  // Apply inclusion patterns if any
  if (values.only.length > 0) {
    const includePatterns = values.only.map(pattern => new RegExp(pattern))
    filtered = filtered.filter(item => includePatterns.some(pattern => pattern.test(item)))
  }

  // Apply exclusion patterns if any
  if (values.not.length > 0) {
    const excludePatterns = values.not.map(pattern => new RegExp(pattern))
    filtered = filtered.filter(item => !excludePatterns.some(pattern => pattern.test(item)))
  }

  return filtered.sort()
}

switch (command) {
  case 'build': {
    if (!packageName) {
      console.error('Usage: workspace build <package> [options]')
      process.exit(1)
    }

    const workspace = await findWorkspace(packageName)
    if (!workspace) {
      console.error(`Could not find workspace for package ${packageName}`)
      process.exit(1)
    }

    // Detect target from package.json engines
    const isServerSide = !!workspace.packageJson.engines?.bun

    buildPackage({
      license: values.license,
      name: packageName,
      outdir: values.outdir,
      target: isServerSide ? 'bun' : 'browser',
      version: values.version,
    }).catch(console.error)
    break
  }

  case 'build-all': {
    const workspaces = await getAllWorkspaces()
    const failed: string[] = []

    for (const name of workspaces) {
      const workspace = await findWorkspace(name)
      if (!workspace) continue

      const isServerSide = !!workspace.packageJson.engines?.bun
      console.log(`\nBuilding ${name}...`)

      try {
        await buildPackage({
          name,
          outdir: values.outdir,
          target: isServerSide ? 'bun' : 'browser',
          version: values.version,
        })
      } catch (error) {
        console.error(`Failed to build ${name}:`, error)
        failed.push(name)
      }
    }

    if (failed.length > 0) {
      console.error('\nThe following packages failed to build:')
      failed.forEach(name => console.error(`- ${name}`))
      process.exit(1)
    }
    break
  }

  case 'changed':
    getChangedWorkspaces()
      .then(packages => console.log(JSON.stringify(filterByPatterns(packages))))
      .catch(console.error)
    break

  case 'changed-files':
    getChangedFiles()
      .then(files => console.log(JSON.stringify(filterByPatterns(files))))
      .catch(console.error)
    break

  case 'find':
    if (!packageName) {
      console.error('Usage: workspace find <package>')
      process.exit(1)
    }
    findWorkspace(packageName)
      .then(workspace => {
        if (!workspace) {
          console.error(`Could not find workspace for package ${packageName}`)
          process.exit(1)
        }
        console.log(workspace.packagePath)
      })
      .catch(console.error)
    break

  case 'list':
    getAllWorkspaces()
      .then(packages => console.log(JSON.stringify(filterByPatterns(packages))))
      .catch(console.error)
    break

  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
