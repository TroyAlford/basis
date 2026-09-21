/**
 * Ported from `eslint-plugin-import`'s `no-extraneous-dependencies` rule
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original copyright (c) 2015 Ben Mosher and contributors.
 *
 * Basis only relies on the rule's observable behavior for bare imports/exports,
 * so this port matches the declared package name against the nearest
 * `package.json` directly instead of resolving the module on disk. Bundler and
 * `tsconfig` alias resolution is intentionally not implemented (`includeInternal`
 * is accepted but ignored), because Basis declares every `@basis/*` workspace
 * dependency explicitly. A package that imports itself by name is treated as
 * internal, matching the original's resolved-path behavior. As a consequence,
 * an undeclared package is reported even when it is not installed, which the
 * original rule would silently skip.
 */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'

interface DeclarationStatus {
  isInBundledDeps: boolean,
  isInDeps: boolean,
  isInDevDeps: boolean,
  isInOptDeps: boolean,
  isInPeerDeps: boolean,
}

interface DependencyFields {
  bundledDependencies: string[],
  dependencies: Record<string, unknown>,
  devDependencies: Record<string, unknown>,
  name?: string,
  optionalDependencies: Record<string, unknown>,
  peerDependencies: Record<string, unknown>,
}

interface PackageReadError {
  data?: { error: string },
  messageId: 'packageNotFound' | 'packageUnparsable',
}

interface ResolvedOptions {
  allowBundledDeps: boolean,
  allowDevDeps: boolean,
  allowModules: Set<string>,
  allowOptDeps: boolean,
  allowPeerDeps: boolean,
  verifyTypeImports: boolean,
}

interface RuleOptions {
  allowModules?: string[],
  bundledDependencies?: boolean | string[],
  devDependencies?: boolean | string[],
  includeInternal?: boolean,
  includeTypes?: boolean,
  optionalDependencies?: boolean | string[],
  packageDir?: string | string[],
  peerDependencies?: boolean | string[],
  verifyTypeImports?: boolean,
}

const BUILT_IN_MODULES = new Set(builtinModules)
const GLOB_REGEXP_SPECIALS = '.+^${}()|[]\\'

const dependencyCache = new Map<string, DependencyFields | null>()

const emptyDependencyFields = (): DependencyFields => ({
  bundledDependencies: [],
  dependencies: {},
  devDependencies: {},
  name: undefined,
  optionalDependencies: {},
  peerDependencies: {},
})

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const asArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'object' && value !== null ? Object.keys(value) : []
}

const extractDependencyFields = (pkg: Record<string, unknown>): DependencyFields => ({
  bundledDependencies: asArray(pkg.bundleDependencies ?? pkg.bundledDependencies),
  dependencies: asRecord(pkg.dependencies),
  devDependencies: asRecord(pkg.devDependencies),
  name: typeof pkg.name === 'string' ? pkg.name : undefined,
  optionalDependencies: asRecord(pkg.optionalDependencies),
  peerDependencies: asRecord(pkg.peerDependencies),
})

const readDependencyFields = (packageJsonPath: string): DependencyFields | null => {
  const cached = dependencyCache.get(packageJsonPath)
  if (cached !== undefined) return cached
  let fields: DependencyFields | null
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
    fields = extractDependencyFields(pkg)
  } catch {
    fields = null
  }
  dependencyCache.set(packageJsonPath, fields)
  return fields
}

const readDependencyFieldsStrict = (packageJsonPath: string): DependencyFields => {
  const cached = dependencyCache.get(packageJsonPath)
  if (cached) return cached
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
  const fields = extractDependencyFields(pkg)
  dependencyCache.set(packageJsonPath, fields)
  return fields
}

const findNearestPackageJson = (filename: string): string | null => {
  let directory = dirname(resolve(filename))
  while (true) {
    const candidate = join(directory, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

const mergeDependencyFields = (target: DependencyFields, source: DependencyFields | null): void => {
  if (!source) return
  Object.assign(target.bundledDependencies, source.bundledDependencies)
  Object.assign(target.dependencies, source.dependencies)
  Object.assign(target.devDependencies, source.devDependencies)
  Object.assign(target.optionalDependencies, source.optionalDependencies)
  Object.assign(target.peerDependencies, source.peerDependencies)
  if (source.name) target.name = source.name
}

const hasAnyDependencies = (fields: DependencyFields): boolean => {
  if (fields.bundledDependencies.length > 0) return true
  if (Object.keys(fields.dependencies).length > 0) return true
  if (Object.keys(fields.devDependencies).length > 0) return true
  if (Object.keys(fields.optionalDependencies).length > 0) return true
  return Object.keys(fields.peerDependencies).length > 0
}

const getErrorCode = (error: unknown): string | undefined => {
  if (error instanceof Error && 'code' in error) return String((error as { code?: unknown }).code)
  return undefined
}

const toPackageReadError = (error: unknown): PackageReadError | null => {
  if (error instanceof SyntaxError) return { data: { error: error.message }, messageId: 'packageUnparsable' }
  if (getErrorCode(error) === 'ENOENT') return { messageId: 'packageNotFound' }
  return null
}

const collectDependencies = (
  filename: string,
  packageDir: string | string[] | undefined,
): { errors: PackageReadError[], fields: DependencyFields | null } => {
  const fields = emptyDependencyFields()
  const errors: PackageReadError[] = []
  const directories = packageDir
    ? (Array.isArray(packageDir) ? packageDir : [packageDir]).map(directory => resolve(directory))
    : []

  if (directories.length > 0) {
    for (const directory of directories) {
      const packageJsonPath = join(directory, 'package.json')
      if (directories.length > 1) {
        mergeDependencyFields(fields, readDependencyFields(packageJsonPath))
        continue
      }
      try {
        mergeDependencyFields(fields, readDependencyFieldsStrict(packageJsonPath))
      } catch (error) {
        const readError = toPackageReadError(error)
        if (readError) errors.push(readError)
      }
    }
  } else {
    const packageJsonPath = findNearestPackageJson(filename)
    mergeDependencyFields(fields, packageJsonPath ? readDependencyFields(packageJsonPath) : null)
  }

  return { errors, fields: hasAnyDependencies(fields) ? fields : null }
}

const getModuleOriginalName = (specifier: string): string | null => {
  const [first, second] = specifier.split('/')
  if (!first) return null
  if (!first.startsWith('@')) return first
  return second ? `${first}/${second}` : null
}

const isBuiltInModule = (specifier: string): boolean => {
  if (specifier === 'bun' || specifier.startsWith('bun:') || specifier.startsWith('node:')) return true
  return BUILT_IN_MODULES.has(specifier)
}

const isBareSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith('.') || isAbsolute(specifier)) return false
  if (specifier.includes(':')) return false
  return /^[\w@]/.test(specifier)
}

const isTypeOnly = (node: unknown): boolean => {
  if (typeof node !== 'object' || node === null) return false
  const candidate = node as { exportKind?: unknown, importKind?: unknown, specifiers?: unknown }
  if (candidate.importKind === 'type' || candidate.importKind === 'typeof') return true
  if (candidate.exportKind === 'type') return true
  if (!Array.isArray(candidate.specifiers) || candidate.specifiers.length === 0) return false
  return candidate.specifiers.every(specifier => {
    if (typeof specifier !== 'object' || specifier === null) return false
    const kind = (specifier as { importKind?: unknown }).importKind
    return kind === 'type' || kind === 'typeof'
  })
}

const getStringLiteralValue = (node: ESTree.Node | null | undefined): string | null => {
  if (node && node.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

const checkDependencyDeclaration = (
  deps: DependencyFields,
  packageName: string,
  status: DeclarationStatus = {
    isInBundledDeps: false,
    isInDeps: false,
    isInDevDeps: false,
    isInOptDeps: false,
    isInPeerDeps: false,
  },
): DeclarationStatus => {
  const hierarchy: string[] = []
  const parts = packageName.split('/')
  parts.forEach((part, index) => {
    if (!part.startsWith('@')) hierarchy.push(parts.slice(0, index + 1).join('/'))
  })
  return hierarchy.reduce<DeclarationStatus>((result, ancestorName) => ({
    isInBundledDeps: result.isInBundledDeps || deps.bundledDependencies.includes(ancestorName),
    isInDeps: result.isInDeps || deps.dependencies[ancestorName] !== undefined,
    isInDevDeps: result.isInDevDeps || deps.devDependencies[ancestorName] !== undefined,
    isInOptDeps: result.isInOptDeps || deps.optionalDependencies[ancestorName] !== undefined,
    isInPeerDeps: result.isInPeerDeps || deps.peerDependencies[ancestorName] !== undefined,
  }), status)
}

const globToRegExp = (glob: string): RegExp => {
  let expression = ''
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index] ?? ''
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index++
        if (glob[index + 1] === '/') {
          index++
          expression += '(?:.*/)?'
        } else {
          expression += '.*'
        }
      } else {
        expression += '[^/]*'
      }
      continue
    }
    if (character === '?') {
      expression += '[^/]'
      continue
    }
    expression += GLOB_REGEXP_SPECIALS.includes(character) ? `\\${character}` : character
  }
  return new RegExp(`^${expression}$`)
}

const matchesGlob = (filename: string, glob: string): boolean => {
  const normalizedFilename = filename.replace(/\\/g, '/')
  const cwdGlob = join(process.cwd(), glob).replace(/\\/g, '/')
  return globToRegExp(glob.replace(/\\/g, '/')).test(normalizedFilename)
    || globToRegExp(cwdGlob).test(normalizedFilename)
}

const testConfig = (config: boolean | string[] | undefined, filename: string): boolean | undefined => {
  if (typeof config === 'boolean' || typeof config === 'undefined') return config
  return config.some(glob => matchesGlob(filename, glob))
}

const resolveOptions = (options: RuleOptions, filename: string): ResolvedOptions => ({
  allowBundledDeps: testConfig(options.bundledDependencies, filename) !== false,
  allowDevDeps: testConfig(options.devDependencies, filename) !== false,
  allowModules: new Set(options.allowModules ?? []),
  allowOptDeps: testConfig(options.optionalDependencies, filename) !== false,
  allowPeerDeps: testConfig(options.peerDependencies, filename) !== false,
  verifyTypeImports: Boolean(options.verifyTypeImports) || Boolean(options.includeTypes),
})

export const noExtraneousDependencies: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as unknown as RuleOptions
    const filename = context.physicalFilename
    const resolvedOptions = resolveOptions(options, filename)
    const { errors, fields } = collectDependencies(filename, options.packageDir)
    const deps = fields ?? emptyDependencyFields()

    for (const error of errors) {
      context.report({ data: error.data, loc: { column: 0, line: 0 }, messageId: error.messageId })
    }

    const report = (node: ESTree.Node, specifier: string | null | undefined): void => {
      if (!specifier || isBuiltInModule(specifier) || !isBareSpecifier(specifier)) return
      if (!resolvedOptions.verifyTypeImports && isTypeOnly(node)) return

      const packageName = getModuleOriginalName(specifier)
      if (!packageName || resolvedOptions.allowModules.has(packageName)) return

      /*
       * The nearest package importing itself by name (`@basis/react` inside
       * `@basis/react`) resolves internally; the original skips it as internal.
       */
      if (packageName === deps.name) return

      const status = checkDependencyDeclaration(deps, packageName)
      if (status.isInDeps) return
      if (resolvedOptions.allowDevDeps && status.isInDevDeps) return
      if (resolvedOptions.allowPeerDeps && status.isInPeerDeps) return
      if (resolvedOptions.allowOptDeps && status.isInOptDeps) return
      if (resolvedOptions.allowBundledDeps && status.isInBundledDeps) return

      if (status.isInDevDeps && !resolvedOptions.allowDevDeps) {
        context.report({ data: { packageName }, messageId: 'devDependency', node })
        return
      }
      if (status.isInOptDeps && !resolvedOptions.allowOptDeps) {
        context.report({ data: { packageName }, messageId: 'optionalDependency', node })
        return
      }
      context.report({ data: { packageName }, messageId: 'missingDependency', node })
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return
        const [argument] = node.arguments
        report(node, getStringLiteralValue(argument))
      },

      ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
        report(node, getStringLiteralValue(node.source))
      },

      ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
        if (node.source) report(node, getStringLiteralValue(node.source))
      },

      ImportDeclaration(node: ESTree.ImportDeclaration) {
        report(node, getStringLiteralValue(node.source))
      },

      ImportExpression(node: ESTree.ImportExpression) {
        report(node, getStringLiteralValue(node.source))
      },

      'Program:exit'() {
        dependencyCache.clear()
      },
    }
  },
  meta: {
    docs: {
      description: 'Forbid the use of extraneous packages.',
    },
    messages: {
      devDependency: "'{{packageName}}' should be listed in the project's dependencies, not devDependencies.",
      missingDependency: [
        "'{{packageName}}' should be listed in the project's dependencies.",
        " Run 'npm i -S {{packageName}}' to add it",
      ].join(''),
      optionalDependency: "'{{packageName}}' should be listed in the project's dependencies, not optionalDependencies.",
      packageNotFound: 'The package.json file could not be found.',
      packageUnparsable: 'The package.json file could not be parsed: {{error}}',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          allowModules: { items: { type: 'string' }, type: 'array' },
          bundledDependencies: { type: ['array', 'boolean'] },
          devDependencies: { type: ['array', 'boolean'] },
          includeInternal: { type: 'boolean' },
          includeTypes: { type: 'boolean' },
          optionalDependencies: { type: ['array', 'boolean'] },
          packageDir: { type: ['array', 'string'] },
          peerDependencies: { type: ['array', 'boolean'] },
          verifyTypeImports: { type: 'boolean' },
        },
        type: 'object',
      },
    ],
    type: 'problem',
  },
}
