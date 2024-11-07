#!/usr/bin/env bun
/* eslint-disable no-console */
import { parseArgs } from 'node:util'
import { buildPackage } from '../functions/buildPackage'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  args: Bun.argv.slice(2),
  options: {
    outdir: { default: 'dist', short: 'o', type: 'string' },
    version: { short: 'v', type: 'string' },
  },
})

const [command, packageName] = positionals

if (!command || !packageName) {
  console.error('Usage: workspace <command> <package> [options]')
  process.exit(1)
}

switch (command) {
  case 'build':
    buildPackage({
      name: packageName,
      outdir: values.outdir,
      version: values.version,
    }).catch(console.error)
    break

  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
