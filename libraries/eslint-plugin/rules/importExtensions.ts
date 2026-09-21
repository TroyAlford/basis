/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Ensures consistent use of file extensions in import paths. Unlike the
 * upstream rule, Basis always autofixes add/remove changes (the shared config
 * supplies the extension map as a flat object, which the upstream plugin only
 * surfaces as suggestions). Path resolution uses `node:fs` rather than
 * `eslint-module-utils`, matching the default node resolver's extensions.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { existsSync, statSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'

type Modifier = 'always' | 'ignorePackages' | 'never'

type RuleSchema = Extract<NonNullable<Rule.RuleModule['meta']>['schema'], readonly unknown[]>[number]

interface ExtensionSettings {
  checkTypeImports: boolean,
  defaultConfig: Modifier,
  ignorePackages: boolean,
  pathGroupOverrides: PathGroupOverride[],
  pattern: Record<string, Modifier | undefined>,
}

interface PathGroupOverride {
  action: 'enforce' | 'ignore',
  pattern: string,
  patternOptions?: Record<string, unknown>,
}

interface PathParts {
  hash: string,
  pathname: string,
  query: string,
}

const RESOLVE_EXTENSIONS = ['.mjs', '.cjs', '.js', '.json', '.node']
const DTS_PATTERN = /\.d\.[cm]?ts$/
const DIRECTORY_PATTERN = /([\\/]|[\\/]?\.?\.)$/

const modifierSchema: RuleSchema = { enum: ['always', 'ignorePackages', 'never'] }
const patternSchema: RuleSchema = {
  patternProperties: { '.*': modifierSchema },
  type: 'object',
}
const overrideSchema: RuleSchema = {
  additionalProperties: false,
  items: {
    additionalProperties: false,
    properties: {
      action: { enum: ['enforce', 'ignore'], type: 'string' },
      pattern: { type: 'string' },
      patternOptions: { type: 'object' },
    },
    required: ['pattern', 'action'],
    type: 'object',
  },
  type: 'array',
}
const propertySchema: RuleSchema = {
  properties: {
    checkTypeImports: { type: 'boolean' },
    ignorePackages: { type: 'boolean' },
    pathGroupOverrides: overrideSchema,
    pattern: patternSchema,
  },
  type: 'object',
}
const optionsSchema: RuleSchema = {
  anyOf: [
    { additionalItems: false, items: [modifierSchema], type: 'array' },
    { additionalItems: false, items: [modifierSchema, propertySchema], type: 'array' },
    { additionalItems: false, items: [propertySchema], type: 'array' },
    { additionalItems: false, items: [patternSchema], type: 'array' },
    { additionalItems: false, items: [modifierSchema, patternSchema], type: 'array' },
  ],
}

const MODIFIERS: Record<string, Modifier> = {
  always: 'always',
  ignorePackages: 'ignorePackages',
  never: 'never',
}

const isModifier = (value: unknown): value is Modifier => typeof value === 'string' && value in MODIFIERS

const assignPattern = (target: Record<string, Modifier | undefined>, source: Record<string, unknown>): void => {
  for (const [extension, value] of Object.entries(source)) {
    if (isModifier(value)) target[extension] = value
  }
}

const buildSettings = (options: unknown[]): ExtensionSettings => {
  const settings: ExtensionSettings = {
    checkTypeImports: false,
    defaultConfig: 'never',
    ignorePackages: false,
    pathGroupOverrides: [],
    pattern: {},
  }

  for (const option of options) {
    if (typeof option === 'string') {
      if (isModifier(option)) settings.defaultConfig = option
      continue
    }
    if (typeof option !== 'object' || option === null) continue

    const value = option as Record<string, unknown>
    const flat = value.pattern === undefined
      && value.ignorePackages === undefined
      && value.checkTypeImports === undefined
    if (flat) {
      assignPattern(settings.pattern, value)
      continue
    }
    if (typeof value.pattern === 'object' && value.pattern !== null) {
      assignPattern(settings.pattern, value.pattern as Record<string, unknown>)
    }
    if (typeof value.ignorePackages === 'boolean') settings.ignorePackages = value.ignorePackages
    if (typeof value.checkTypeImports === 'boolean') settings.checkTypeImports = value.checkTypeImports
    if (Array.isArray(value.pathGroupOverrides)) {
      settings.pathGroupOverrides = value.pathGroupOverrides as PathGroupOverride[]
    }
  }

  if (settings.defaultConfig === 'ignorePackages') {
    settings.defaultConfig = 'always'
    settings.ignorePackages = true
  }

  return settings
}

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile()

const escapeGlobChar = (char: string): string => (char === '/' ? '/' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

const globToRegExp = (pattern: string): RegExp => {
  let source = ''
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index++
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += escapeGlobChar(char)
    }
  }
  return new RegExp(`^${source}$`)
}

const parsePath = (value: string): PathParts => {
  const hashIndex = value.indexOf('#')
  const queryIndex = value.indexOf('?')
  const hasHash = hashIndex > 0
  const hash = hasHash ? value.slice(hashIndex) : ''
  const hasQuery = queryIndex !== -1 && (!hasHash || queryIndex < hashIndex)
  const query = hasQuery ? value.slice(queryIndex, hasHash ? hashIndex : undefined) : ''
  const pathname = hasQuery
    ? value.slice(0, queryIndex)
    : hasHash
      ? value.slice(0, hashIndex)
      : value
  return { hash, pathname, query }
}

const stringifyPath = ({ hash, pathname, query }: PathParts): string => `${pathname}${query}${hash}`

const isScoped = (name: string): boolean => /^@[^/]+\/?[^/]+/.test(name)

const isExternalRootModule = (name: string): boolean => {
  if (name === '.' || name === '..') return false
  const slashCount = name.split('/').length - 1
  return slashCount === 0 || (isScoped(name) && slashCount <= 1)
}

const computeOverrideAction = (
  overrides: PathGroupOverride[],
  importPath: string,
): PathGroupOverride['action'] | undefined => {
  for (const override of overrides) {
    if (globToRegExp(override.pattern).test(importPath)) return override.action
  }
  return undefined
}

const replaceImportPath = (sourceText: string, importPath: string): string => sourceText
  .replace(/^(['"])(.+)\1$/, (_match, quote: string) => `${quote}${importPath}${quote}`)

export const importExtensions: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const settings = buildSettings(context.options as unknown[])
    const directory = path.dirname(context.physicalFilename || context.filename)
    const coreModules = context.settings['import-x/core-modules'] ?? context.settings['import/core-modules']

    const resolvePath = (importPath: string): string | null => {
      if (!importPath.startsWith('.') && !path.isAbsolute(importPath)) return null
      const base = path.isAbsolute(importPath) ? importPath : path.resolve(directory, importPath)
      if (isFile(base)) return base
      for (const extension of RESOLVE_EXTENSIONS) {
        if (isFile(`${base}${extension}`)) return `${base}${extension}`
      }
      for (const extension of RESOLVE_EXTENSIONS) {
        const indexFile = path.join(base, `index${extension}`)
        if (isFile(indexFile)) return indexFile
      }
      return null
    }

    const isCoreModule = (importPath: string): boolean => {
      const base = isScoped(importPath)
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0]
      if (base !== undefined && isBuiltin(base)) return true
      return Array.isArray(coreModules) && (coreModules as unknown[]).includes(base)
    }

    const isPackage = (importPath: string): boolean => isScoped(importPath) || /^\w/.test(importPath)

    const isTypeOnly = (node: ESTree.Node): boolean => {
      const kind = node as { exportKind?: string, importKind?: string }
      return kind.importKind === 'type' || kind.exportKind === 'type'
    }

    const getModifier = (extension: string): Modifier => settings.pattern[extension] ?? settings.defaultConfig

    const isUseOfExtensionRequired = (extension: string, packageImport: boolean): boolean => {
      const modifier = getModifier(extension)
      return modifier === 'always' && (!settings.ignorePackages || !packageImport)
    }

    const isUseOfExtensionForbidden = (extension: string): boolean => getModifier(extension) === 'never'

    const isResolvableWithoutExtension = (file: string): boolean => {
      const extension = path.extname(file)
      const withoutExtension = file.slice(0, -extension.length)
      return resolvePath(withoutExtension) === resolvePath(file)
    }

    const checkFileExtension = (source: ESTree.Literal, node: ESTree.Node): void => {
      if (!source.value || typeof source.value !== 'string') return

      const importPathWithQueryString = source.value
      const overrideAction = computeOverrideAction(settings.pathGroupOverrides, importPathWithQueryString)
      if (overrideAction === 'ignore') return
      if (!overrideAction && isCoreModule(importPathWithQueryString)) return

      const { hash, pathname: importPath, query } = parsePath(importPathWithQueryString)
      if (!overrideAction && isExternalRootModule(importPath)) return

      const resolvedPath = resolvePath(importPath)
      const resolvedToDts = resolvedPath !== null && DTS_PATTERN.test(resolvedPath)
      const extension = path.extname(resolvedToDts ? importPath : resolvedPath ?? importPath).slice(1)
      const packageImport = !overrideAction && isPackage(importPath)

      if (!extension || !importPath.endsWith(`.${extension}`)) {
        if (resolvedToDts && !extension && isPackage(importPath)) return
        if (!settings.checkTypeImports && isTypeOnly(node)) return
        const extensionRequired = isUseOfExtensionRequired(extension, packageImport)
        const extensionForbidden = isUseOfExtensionForbidden(extension)
        if (!extensionRequired || extensionForbidden) return
        if (!extension) {
          context.report({
            data: { importPath: importPathWithQueryString },
            messageId: 'missing',
            node: source,
          })
          return
        }
        const pathname = DIRECTORY_PATTERN.test(importPath)
          ? `${importPath.endsWith('/') ? importPath.slice(0, -1) : importPath}/index.${extension}`
          : `${importPath}.${extension}`
        const fixedImportPath = stringifyPath({ hash, pathname, query })
        const sourceText = context.sourceCode.getText(source)
        context.report({
          data: { extension, fixedImportPath, importPath: importPathWithQueryString },
          fix: fixer => fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath)),
          messageId: 'missingKnown',
          node: source,
        })
        return
      }

      if (!extension) return
      if (!isUseOfExtensionForbidden(extension) || !isResolvableWithoutExtension(importPath)) return
      const withoutExtension = importPath.slice(0, -(extension.length + 1))
      const pathname = withoutExtension.endsWith('/index') ? withoutExtension.slice(0, -6) : withoutExtension
      const fixedImportPath = stringifyPath({ hash, pathname, query })
      const sourceText = context.sourceCode.getText(source)
      context.report({
        data: { extension, fixedImportPath, importPath: importPathWithQueryString },
        fix: fixer => fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath)),
        messageId: 'unexpected',
        node: source,
      })
    }

    const checkSource = (source: ESTree.Expression | null | undefined, node: ESTree.Node): void => {
      if (source?.type === 'Literal') checkFileExtension(source, node)
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        const callee = node.callee as { name?: string, type: string }
        if (callee.type === 'Import') {
          const [argument] = node.arguments
          if (argument && argument.type === 'Literal') checkSource(argument, node)
          return
        }
        if (callee.type !== 'Identifier' || callee.name !== 'require' || node.arguments.length !== 1) return
        const [argument] = node.arguments
        if (argument && argument.type === 'Literal') checkSource(argument, node)
      },
      ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
        checkSource(node.source, node)
      },
      ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
        checkSource(node.source, node)
      },
      ImportDeclaration(node: ESTree.ImportDeclaration) {
        checkSource(node.source, node)
      },
      ImportExpression(node: ESTree.ImportExpression) {
        checkSource(node.source, node)
      },
    }
  },
  meta: {
    docs: {
      description: 'Ensure consistent use of file extension within the import path.',
    },
    fixable: 'code',
    messages: {
      missing: 'Missing file extension for "{{importPath}}"',
      missingKnown: 'Missing file extension "{{extension}}" for "{{importPath}}"',
      unexpected: 'Unexpected use of file extension "{{extension}}" for "{{importPath}}"',
    },
    schema: optionsSchema,
    type: 'suggestion',
  },
}
