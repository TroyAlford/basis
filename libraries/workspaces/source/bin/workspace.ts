#!/usr/bin/env bun
/* eslint-disable no-console */
import { parseArgs } from 'node:util'
import { isNil, match } from '@basis/utilities'
import { buildPackage } from '../functions/buildPackage'
import { filterByPatterns } from '../functions/filterByPatterns'
import { findWorkspace } from '../functions/findWorkspace'
import { getChangedFiles } from '../functions/getChangedFiles'
import { getChangedWorkspaces } from '../functions/getChangedWorkspaces'
import { listWorkspaces } from '../functions/listWorkspaces'
import { publishJSR } from '../functions/publishJSR'
import type { Workspace } from '../types/Workspace'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  args: Bun.argv.slice(2),
  options: {
    dryRun: { type: 'boolean' },
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
 * Builds a package with the given options.
 * @param name - The name of the package to build.
 * @param workspace - The workspace containing the package.
 * @returns The result of the build.
 */
async function buildPackageWithOptions(name: string, workspace: Workspace) {
  return buildPackage({
    license: values.license,
    name,
    outdir: values.outdir,
    target: workspace.packageJson.engines?.bun ? 'bun' : 'browser',
    version: values.version,
  })
}

(async () => {
  try {
    const result = await match(command)
      .when('build').then(async () => {
        if (!packageName) throw new Error('Usage: workspace build <package> [options]')

        const workspace = await findWorkspace(packageName)
        if (!workspace) throw new Error(`Could not find workspace for package ${packageName}`)

        return await buildPackageWithOptions(packageName, workspace)
      })
      .when('build-all').then(async () => {
        const workspaces = await listWorkspaces({ not: values.not, only: values.only })
        const failed: string[] = []

        for (const name of workspaces) {
          const workspace = await findWorkspace(name)
          if (!workspace) continue

          console.log(`\nBuilding ${name}...`)

          try {
            await buildPackageWithOptions(name, workspace)
          } catch (error) {
            console.error(`Failed to build ${name}:`, error)
            failed.push(name)
          }
        }

        if (failed.length > 0) {
          return 'The following packages failed to build:\n' + failed.map(name => `- ${name}`).join('\n')
        }
        return null // No failures
      })
      .when('changed').then(async () => {
        const workspaces = await getChangedWorkspaces()
        return filterByPatterns(workspaces, values)
      })
      .when('changed-files').then(async () => {
        const files = await getChangedFiles()
        return filterByPatterns(files, values)
      })
      .when('find').then(async () => {
        if (!packageName) throw new Error('Usage: workspace find <package>')

        const workspace = await findWorkspace(packageName)
        if (!workspace) throw new Error(`Could not find workspace for package ${packageName}`)

        return workspace.packagePath
      })
      .when('list').then(() => listWorkspaces({ not: values.not, only: values.only }))
      .when('publish').then(async () => {
        if (!values.version) throw new Error('Usage: workspace publish --version <version> [options]')
        return publishJSR(values)
      })
      .else(() => {
        throw new Error(`Unknown command: ${command}`)
      })

    // Handle the result after the match
    if (typeof result === 'string') {
      console.log(result)
    } else if (!isNil(result)) {
      console.log(JSON.stringify(result))
    }
    process.exit(0)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
})()
