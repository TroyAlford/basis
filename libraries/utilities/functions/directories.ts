import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/** Options for a JSON directory write. */
export interface DirectoryWriteOptions {
  /** File mode; defaults to owner read/write only. */
  readonly mode?: number,
}

/** One lazily-managed Basis state directory. */
export interface Directory {
  /** Create the directory and its ignore marker if needed. */
  ensure(): Promise<string>,
  /** Ensure the directory and resolve a file path beneath it. */
  file(filename: string): Promise<string>,
  /** The directory's relative name inside `.basis`. */
  readonly folder: string,
  /**
   * Read JSON from a file, or return null when the file is absent.
   * @param filename - Single filename beneath this directory.
   */
  json<T = unknown>(filename: string): Promise<T | null>,
  /**
   * Atomically write JSON and return the written content.
   * @param filename - Single filename beneath this directory.
   * @param content - JSON-compatible content, including explicit null.
   * @param options - Write options.
   */
  json<T>(filename: string, content: T, options?: DirectoryWriteOptions): Promise<T>,
  /** Absolute directory path; the directory is created on first use. */
  readonly path: string,
}

/**
 * Validate one path segment so state access cannot escape `.basis`.
 * @param value - Candidate path segment.
 * @param label - Segment kind used in diagnostics.
 * @returns Validated segment.
 */
function segment(value: string, label: string): string {
  if (
    value.length === 0
    || value === '.'
    || value === '..'
    || isAbsolute(value)
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
  ) {
    throw new Error(`Invalid ${label} segment "${value}"`)
  }
  return value
}

/** One lazily-created state directory. */
class ManagedDirectory implements Directory {
  readonly folder: string
  readonly path: string

  /**
   * Build one directory handle under the process working directory.
   * @param folderName - Directory name beneath `.basis`.
   */
  constructor(folderName: string) {
    this.folder = segment(folderName, 'directory')
    this.path = resolve(process.cwd(), '.basis', this.folder)
  }

  /**
   * Create the directory, permissions, and ignore marker if absent.
   * @returns The created directory path.
   */
  async ensure(): Promise<string> {
    await mkdir(this.path, { mode: 0o700, recursive: true })
    await chmod(this.path, 0o700)
    const ignore = join(this.path, '.gitignore')
    try {
      const handle = await open(ignore, 'wx', 0o644)
      try {
        await handle.writeFile('*\n')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return this.path
  }

  /**
   * Ensure this directory and resolve one file beneath it.
   * @param filename - Single filename.
   * @returns Absolute file path.
   */
  async file(filename: string): Promise<string> {
    await this.ensure()
    return join(this.path, segment(filename, 'file'))
  }

  async json<T = unknown>(filename: string): Promise<T | null>
  async json<T>(filename: string, content: T, options?: DirectoryWriteOptions): Promise<T>
  async json<T>(
    filename: string,
    content?: T,
    options: DirectoryWriteOptions = {},
  ): Promise<T | null> {
    const file = await this.file(filename)
    if (arguments.length < 2) {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as T
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }
    const temporary = `${file}.${randomUUID()}`
    await writeFile(temporary, `${JSON.stringify(content, null, 2)}\n`, {
      mode: options.mode ?? 0o600,
    })
    await rename(temporary, file)
    return content as T
  }
}

/**
 * Resolve one conventional Basis state directory under `process.cwd()/.basis`.
 * Directories are created only when accessed.
 * @param folderName - Directory name beneath `.basis`.
 * @returns Lazy directory handle.
 */
export function directories(folderName: string): Directory {
  return new ManagedDirectory(folderName)
}
