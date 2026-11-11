import { Graph } from 'basis/server'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const graphFile = join(root, 'graph.ts')
const snapshotFile = join(root, 'graph.json')
const module = await import(`${pathToFileURL(graphFile).href}?generate=${Date.now()}`) as {
  default?: unknown,
  graph?: unknown,
}
const graph = module.graph ?? module.default
if (!(graph instanceof Graph)) {
  throw new Error(`${graphFile} must export a Graph as \`graph\` or the default export`)
}
const snapshot = `${JSON.stringify(graph, null, 2)}\n`
if (process.argv.includes('--check')) {
  const committed = await readFile(snapshotFile, 'utf8')
  if (committed !== snapshot) {
    throw new Error('graph.json is stale; run `bun run graph:generate` and commit the result')
  }
  process.stdout.write('[basis] graph: snapshot is current\n')
} else {
  await writeFile(snapshotFile, snapshot)
  process.stdout.write('[basis] graph: wrote graph.json\n')
}
