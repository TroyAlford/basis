import { existsSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JsonSchemaEmitter, TypeScriptEmitter } from '../libraries/codegen'

/** Conventional application Graph module. */
const GRAPH_FILES = ['graph.ts', 'graph.tsx', 'graph.js', 'graph.mjs']
/** Conventional application emitter folder. */
const EMITTER_FOLDER = 'emitters'
/** Conventional generated output folder. */
const OUTPUT_FOLDER = 'generated'
/** Emitter module extensions discovered by convention. */
const EMITTER_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx'])

/** One callable application or built-in emitter. */
interface DiscoveredEmitter {
  /** Materialize one emitter's output. */
  (graph: unknown, root?: string): Promise<void>,
  /** Extension owned by the emitter. */
  readonly extension: string,
  /** Output folder owned by the emitter. */
  readonly folder: string,
}

/** Result of one convention-driven emit run. */
export interface EmitResult {
  /** Sorted emitter folder names, including built-ins. */
  readonly emitters: readonly string[],
  /** Absolute output root. */
  readonly outputRoot: string,
}

/**
 * Run the conventional Basis emit lifecycle for one application root.
 *
 * The application supplies `graph.ts` and optional `emitters/*` modules. Each
 * emitter default-exports the `emitter(...)` callable; built-in emitters always
 * run first, followed by application emitters in sorted filename order.
 * @param root - Application root; defaults to the current working directory.
 * @returns The emitted output summary, or null when no application Graph exists.
 * @throws {Error} When the Graph or an emitter module is invalid.
 */
export async function emit(root = process.cwd()): Promise<EmitResult | null> {
  const applicationRoot = resolve(root)
  const graphPath = GRAPH_FILES.map(file => join(applicationRoot, file))
    .find(path => existsSync(path))
  if (!graphPath) return null
  const graphModule = await import(pathToFileURL(graphPath).href) as {
    readonly default?: unknown,
    readonly graph?: unknown,
  }
  const graph = graphModule.default ?? graphModule.graph
  if (!isGraph(graph)) throw new Error('[basis] graph.ts must default-export a constructed Graph')
  const outputRoot = join(applicationRoot, OUTPUT_FOLDER)
  const builtIns: DiscoveredEmitter[] = [TypeScriptEmitter, JsonSchemaEmitter]
  const application = await discoverEmitters(join(applicationRoot, EMITTER_FOLDER))
  for (const emitter of [...builtIns, ...application]) {
    await emitter(graph, outputRoot)
  }
  return {
    emitters: [...builtIns, ...application].map(emitter => emitter.folder),
    outputRoot,
  }
}

/**
 * Discover application emitters from one conventional folder.
 * @param folder - Absolute emitter folder.
 * @returns Default-exported emitters in sorted filename order.
 * @throws {Error} When a module has no callable default export.
 */
async function discoverEmitters(folder: string): Promise<readonly DiscoveredEmitter[]> {
  if (!existsSync(folder)) return []
  const files = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && EMITTER_EXTENSIONS.has(extname(entry.name)))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))
  const emitters: DiscoveredEmitter[] = []
  for (const file of files) {
    const path = join(folder, file)
    const module = await import(pathToFileURL(path).href) as { default?: unknown }
    if (!isEmitter(module.default)) {
      throw new Error(`[basis] emitter ${file} must default-export an emitter callable`)
    }
    emitters.push(module.default)
  }
  return emitters
}

/**
 * Whether a value is a constructed canonical Graph.
 * @param value - Candidate value.
 * @returns Whether it exposes Graph's canonical definitions and physical schema.
 */
function isGraph(value: unknown): value is { readonly definitions: unknown } {
  return typeof value === 'object'
    && value !== null
    && 'definitions' in value
    && 'physicalSchema' in value
}

/**
 * Whether a value is a callable emitter with its own destination.
 * @param value - Candidate value.
 * @returns Whether it follows the emitter contract.
 */
function isEmitter(value: unknown): value is DiscoveredEmitter {
  return typeof value === 'function'
    && typeof (value as { extension?: unknown }).extension === 'string'
    && typeof (value as { folder?: unknown }).folder === 'string'
}
