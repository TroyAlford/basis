/**
 * Ported from `eslint-plugin-import`'s `no-extraneous-dependencies` rule
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original copyright (c) 2015 Ben Mosher and contributors.
 *
 * Basis consumes this rule with a single, non-configurable policy:
 *  - a bare (non-relative) import/export is fine when its package is declared in
 *    the nearest `package.json` in any of `dependencies`, `devDependencies`,
 *    `optionalDependencies`, `peerDependencies`, or `bundledDependencies`;
 *  - type-only imports/exports, relative/absolute specifiers, Node and Bun
 *    builtins, and self-references are always ignored.
 *
 * The declared package name is matched against `package.json` directly rather
 * than resolving the module on disk, and bundler/`tsconfig` alias resolution is
 * intentionally not implemented (`@basis/*` workspace dependencies are declared
 * explicitly). Consequently, an undeclared package is reported even when it is
 * not installed, which the original rule would silently skip.
 */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'

interface DependencyFields {
  bundledDependencies: string[],
  dependencies: Record<string, unknown>,
  devDependencies: Record<string, unknown>,
  name?: string,
  optionalDependencies: Record<string, unknown>,
  peerDependencies: Record<string, unknown>,
}

const BUILT_IN_MODULES = new Set(builtinModules)

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

const hasAnyDependencies = (fields: DependencyFields): boolean => {
  if (fields.bundledDependencies.length > 0) return true
  if (Object.keys(fields.dependencies).length > 0) return true
  if (Object.keys(fields.devDependencies).length > 0) return true
  if (Object.keys(fields.optionalDependencies).length > 0) return true
  return Object.keys(fields.peerDependencies).length > 0
}

const collectDependencies = (filename: string): DependencyFields | null => {
  const packageJsonPath = findNearestPackageJson(filename)
  const fields = packageJsonPath ? readDependencyFields(packageJsonPath) : null
  if (!fields || !hasAnyDependencies(fields)) return null
  return fields
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

const isDeclared = (deps: DependencyFields, packageName: string): boolean => {
  if (deps.dependencies[packageName] !== undefined) return true
  if (deps.devDependencies[packageName] !== undefined) return true
  if (deps.optionalDependencies[packageName] !== undefined) return true
  if (deps.peerDependencies[packageName] !== undefined) return true
  return deps.bundledDependencies.includes(packageName)
}

export const noExtraneousDependencies: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const deps = collectDependencies(context.physicalFilename) ?? emptyDependencyFields()

    const report = (node: ESTree.Node, specifier: string | null | undefined): void => {
      if (!specifier || isBuiltInModule(specifier) || !isBareSpecifier(specifier)) return
      if (isTypeOnly(node)) return

      const packageName = getModuleOriginalName(specifier)
      if (!packageName) return

      /*
       * The nearest package importing itself by name (`@basis/react` inside
       * `@basis/react`) resolves internally; the original skips it as internal.
       */
      if (packageName === deps.name) return
      if (isDeclared(deps, packageName)) return

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
      missingDependency: [
        "'{{packageName}}' should be listed in the project's dependencies.",
        " Run 'npm i -S {{packageName}}' to add it",
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
