/* eslint-disable consistent-return, no-console */
import chalk from 'chalk'
import { resolve } from 'path'
import { pluginGlobals, pluginSASS } from '@basis/bun-plugins'
import { formatBytes, formatMilliseconds } from '@basis/utilities'
import type { PackageJSON } from '../types/PackageJSON'
import { findWorkspace } from './findWorkspace'

/** Build options */
interface BuildOptions {
  /** External dependencies */
  external?: string[],
  /** Package name */
  name: string,
  /** Output directory */
  outdir?: string,
  /** Package version */
  version: string,
}

/**
 * Build a package
 * @param options - Build options
 * @returns Build result
 */
export async function buildPackage(options: BuildOptions) {
  const startTime = performance.now()
  const { external = [], name, outdir = 'dist', version } = options

  const workspace = await findWorkspace(name)
  if (!workspace) {
    console.error(`Could not find workspace for package ${name}`)
    process.exit(1)
  }

  const { packageJson, packagePath } = workspace
  const entrypoint = 'index.ts'
  const packageJsonPath = resolve(packagePath, 'package.json')

  // Get all workspace dependencies as externals
  const workspaceDeps = {
    ...packageJson.dependencies,
    ...packageJson.peerDependencies,
  }

  const basisExternals = Object.keys(workspaceDeps)
    .filter(dep => dep.startsWith('@basis/'))

  const allExternals = [
    'react',
    'react-dom',
    ...basisExternals,
    ...external,
  ]

  try {
    const result = await Bun.build({
      define: {
        'Bun.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      },
      entrypoints: [resolve(packagePath, entrypoint)],
      external: allExternals,
      minify: {
        identifiers: false,
        syntax: true,
        whitespace: true,
      },
      outdir: resolve(packagePath, outdir),
      plugins: [
        pluginGlobals({
          'react': 'window.React',
          'react-dom': 'window.ReactDOM',
          'react-dom/client': 'window.ReactDOM',
        }),
        pluginSASS(packagePath),
      ],
      sourcemap: 'external',
    })

    if (!result.success) {
      console.error(`Failed to build ${name}:`, result.logs)
      process.exit(1)
    }

    // Calculate total bundle size
    const totalSize = result.outputs.reduce((sum, output) => sum + output.size, 0)
    const duration = performance.now() - startTime

    // Update the package.json in-place
    const updatedPackageJson: PackageJSON = {
      ...packageJson,
      files: [
        `${outdir}/*.js`,
        `${outdir}/*.js.map`,
        `${outdir}/*.d.ts`,
        'README.md',
        'LICENSE',
      ],
      main: `${outdir}/index.js`,
      module: `${outdir}/index.js`,
      types: `${outdir}/index.d.ts`,
      version,
    }

    await Bun.write(
      packageJsonPath,
      JSON.stringify(updatedPackageJson, null, 2),
    )

    // Pretty output
    console.log('\n' + chalk.dim('='.repeat(50)))
    console.log(`🎉 ${chalk.green('Successfully built')} ${chalk.yellow(name)}@${chalk.yellow(version)}`)
    console.log(chalk.dim('='.repeat(50)))
    console.log(`
📦 Build Details:
   ${chalk.dim('Entry:')}     ${entrypoint}
   ${chalk.dim('Output:')}    ${resolve(packagePath, outdir)}
   ${chalk.dim('Externals:')} ${allExternals.join(', ')}

📊 Stats:
   ${chalk.dim('Duration:')}  ${chalk.cyan(formatMilliseconds(duration))}
   ${chalk.dim('Size:')}      ${chalk.cyan(formatBytes(totalSize))}
   ${chalk.dim('Files:')}     ${chalk.cyan(result.outputs.length)}
`)

    return result
  } catch (error) {
    console.error('\n❌ ' + chalk.yellow(`Error building ${name}:`), error)
    process.exit(1)
  }
}
