/* eslint-disable no-console */
import { parseArgs } from 'node:util'
import { findWorkspace } from './findWorkspace'

const { values } = parseArgs({
  allowPositionals: false,
  args: Bun.argv.slice(2),
  options: {
    name: { required: true, short: 'n', type: 'string' },
  },
})

const workspace = await findWorkspace(values.name)
if (!workspace) {
  console.error(`Could not find workspace for package ${values.name}`)
  process.exit(1)
}

// Just output the path - this is used by the release workflow
console.log(workspace.packagePath)
