/* eslint-disable consistent-return, no-console */
import type { BuildConfig as BunBuildConfig } from 'bun'
import chalk from 'chalk'
import fs from 'fs'
import { resolve } from 'path'
import { pluginGlobals, pluginSASS } from '../../../bun-plugins'
import { formatBytes, formatMilliseconds } from '../../../utilities'
import type { BaseBuildConfig, BuildConfig } from '../types/BuildConfig'
import type { LicenseOption } from '../types/LicenseOption'
import type { PackageJSON } from '../types/PackageJSON'
import { findWorkspace } from './findWorkspace'
import { handleLicense } from './handleLicense'

/** Build options */
interface BuildOptions {
  /** External dependencies */
  external?: string[],
  /** License handling option */
  license?: LicenseOption,
  /** Package name */
  name: string,
  /** Output directory */
  outdir?: string,
  /**
   * Build target (defaults to 'browser')
   * Automatically detected from package.json engines:
   * - 'bun' if engines.bun is specified
   * - 'browser' otherwise
   */
  target?: 'browser' | 'bun',
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
  const {
    external = [],
    license = 'auto',
    name,
    outdir = 'dist',
    target = 'browser',
    version,
  } = options

  const workspace = await findWorkspace(name)
  if (!workspace) {
    console.error(`Could not find workspace for package ${name}`)
    process.exit(1)
  }

  const { packageJson, packagePath } = workspace

  // Check for package-specific build script
  if (packageJson.scripts?.build) {
    // Check if this package should be skipped
    if (packageJson.scripts.build.includes('SKIP')) {
      console.log(chalk.yellow(`⏭️  Skipping build for ${name} (build disabled)`))
      return { skipped: true }
    }

    console.log(`Using package build script for ${name}...`)
    const process = Bun.spawn(['bun', 'run', 'build'], {
      cwd: packagePath,
      env: { ...Bun.env, VERSION: version },
      stderr: 'inherit',
      stdout: 'inherit',
    })

    const success = await process.exited === 0
    if (!success) {
      throw new Error(`Package build script failed for ${name}`)
    }

    const duration = performance.now() - startTime
    console.log('\n' + chalk.dim('='.repeat(50)))
    console.log(`🎉 ${chalk.green('Successfully built')} ${chalk.yellow(name)}@${chalk.yellow(version)}`)
    console.log(chalk.dim('='.repeat(50)))
    console.log(`
📦 Build Details:
   ${chalk.dim('Method:')}    Custom build script
   ${chalk.dim('Duration:')}  ${chalk.cyan(formatMilliseconds(duration))}
`)
    return
  }

  // Continue with default build process if no custom script exists...

  const entrypoint = 'index.ts'
  const packageJsonPath = resolve(packagePath, 'package.json')

  // Get all workspace dependencies as externals
  const workspaceDeps = {
    ...packageJson.dependencies,
    ...packageJson.peerDependencies,
  }

  const basisExternals = Object.keys(workspaceDeps)
    .filter(dep => dep.startsWith('@basis/'))

  // Base build config
  const baseConfig: BaseBuildConfig = {
    entrypoints: [resolve(packagePath, entrypoint)],
    external: [...basisExternals, ...external],
    minify: {
      identifiers: false,
      syntax: true,
      whitespace: true,
    },
    outdir: resolve(packagePath, outdir),
    sourcemap: 'external',
  }

  let buildConfig: BuildConfig

  // Target-specific config
  if (target === 'browser') {
    buildConfig = {
      ...baseConfig,
      define: {
        'Bun.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      },
      external: [...baseConfig.external, 'react', 'react-dom'],
      plugins: [
        pluginGlobals({
          'react': 'window.React',
          'react-dom': 'window.ReactDOM',
          'react-dom/client': 'window.ReactDOM',
        }),
        pluginSASS(),
      ],
      target: 'browser',
    }
  } else {
    buildConfig = {
      ...baseConfig,
      target: 'bun',
    }
  }

  try {
    const result = await Bun.build(buildConfig as BunBuildConfig)

    if (!result.success) {
      console.error(`Failed to build ${name}:`, result.logs)
      process.exit(1)
    }

    // Calculate total bundle size
    const totalSize = result.outputs.reduce((sum, output) => sum + output.size, 0)
    const duration = performance.now() - startTime

    // Create temporary tsconfig for declarations
    const declarationConfig = {
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        jsx: 'react-jsx',
        module: 'ESNext',
        moduleResolution: 'bundler',
        outDir: outdir,
        skipLibCheck: true,
        target: 'ESNext',
      },
      include: [
        resolve(packagePath, '*.ts'),
        resolve(packagePath, '*.tsx'),
      ],
    }

    const tempTsConfigPath = resolve(packagePath, 'tsconfig.build.json')
    await Bun.write(tempTsConfigPath, JSON.stringify(declarationConfig, null, 2))

    // Generate types with temporary config
    console.log('Generating TypeScript declarations...')
    const tsc = Bun.spawn(['tsc', '--project', tempTsConfigPath], {
      cwd: packagePath,
      stderr: 'inherit',
      stdout: 'inherit',
    })

    const typesSuccess = await tsc.exited === 0

    // Clean up temporary config
    await Bun.write(tempTsConfigPath, '')
    await fs.unlinkSync(tempTsConfigPath)

    if (!typesSuccess) {
      throw new Error('Failed to generate TypeScript declarations')
    }

    // Handle license
    const licenseFile = await handleLicense(packagePath, license)

    // Check for README
    const hasReadme = await Bun.file(resolve(packagePath, 'README.md')).exists()

    // Build files array
    const files = [
      `${outdir}/**/*.js`,
      `${outdir}/**/*.js.map`,
      `${outdir}/**/*.d.ts`,
    ]

    if (hasReadme) files.push('README.md')
    if (licenseFile) files.push(licenseFile)

    // Update package.json
    const updatedPackageJson: PackageJSON = {
      ...packageJson,
      files,
      main: `${outdir}/index.js`,
      module: `${outdir}/index.js`,
      source: 'index.ts',
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
   ${chalk.dim('Externals:')} ${baseConfig.external.join(', ')}

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
