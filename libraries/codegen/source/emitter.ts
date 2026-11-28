import type { Graph } from 'basis/server'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** One generated file, without its declared extension. */
export interface EmittedFile {
  /** Generated file content. */
  readonly content: string,
  /** Safe base name without an extension. */
  readonly name: string,
}

/** One emitter's output destination declaration. */
export interface EmitterOptions {
  /** File extension appended by the emitter, without a leading dot. */
  readonly extension: string,
  /** Safe folder beneath the caller-selected output root. */
  readonly folder: string,
}

/** A format-specific content generator over the canonical in-memory Graph. */
export type EmitterGenerate = (graph: Graph) => Iterable<EmittedFile> | Promise<Iterable<EmittedFile>>

/** A callable emitter that materializes its own format beneath an output root. */
export interface Emitter {
  /**
   * Materialize this emitter's output.
   * @param graph - Canonical application graph.
   * @param root - Shared output root; defaults to the process working directory.
   * @returns A promise that resolves after every file is written.
   */
  (graph: Graph, root?: string): Promise<void>,
  /** File extension owned by this emitter. */
  readonly extension: string,
  /** Output folder owned by this emitter. */
  readonly folder: string,
}

/** Safe folder and file names, excluding path traversal and separators. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/u
/** Safe extension, without a leading dot. */
const SAFE_EXTENSION = /^[A-Za-z0-9]+$/u

/**
 * Build one independently owned output emitter.
 *
 * The factory owns repetitive destination validation and file writing only.
 * Each emitter module owns its format-specific content and folder/extension.
 * @param options - Declared extension and output folder.
 * @param generate - Format-specific content generator over the canonical Graph.
 * @returns A callable emitter.
 * @throws {Error} When the declared destination is unsafe.
 */
export function emitter(options: EmitterOptions, generate: EmitterGenerate): Emitter {
  assertSegment(options.folder, 'emitter folder')
  if (!SAFE_EXTENSION.test(options.extension)) {
    throw new Error(`Unsafe emitter extension "${options.extension}"`)
  }
  const emit = async (graph: Graph, root = process.cwd()): Promise<void> => {
    const outputRoot = resolve(root)
    const folder = resolve(outputRoot, options.folder)
    assertWithin(outputRoot, folder, 'emitter folder')
    await mkdir(folder, { recursive: true })
    for (const file of await generate(graph)) {
      assertSegment(file.name, 'emitted file name')
      const target = resolve(folder, `${file.name}.${options.extension}`)
      assertWithin(folder, target, 'emitted file')
      await writeFile(target, file.content, 'utf8')
    }
  }
  return Object.assign(emit, {
    extension: options.extension,
    folder: options.folder,
  })
}

/**
 * Require one safe single path segment.
 * @param value - Candidate segment.
 * @param label - Diagnostic label.
 */
function assertSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`Unsafe ${label} "${value}"`)
  }
}

/**
 * Require one resolved path to remain inside its declared parent.
 * @param parent - Resolved parent path.
 * @param target - Resolved candidate path.
 * @param label - Diagnostic label.
 */
function assertWithin(parent: string, target: string, label: string): void {
  const relation = relative(parent, target)
  if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(`Unsafe ${label} destination "${target}"`)
  }
}
