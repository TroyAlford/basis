/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Ensures consistent use of file extensions in import paths. Basis is
 * opinionated, so the extension policy is baked in rather than configurable,
 * and add/remove changes are always autofixed. Path resolution uses `node:fs`
 * rather than `eslint-module-utils`, matching the default node resolver's
 * extensions.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { existsSync, statSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'

type Modifier = 'always' | 'never'

interface PathParts {
  hash: string,
  pathname: string,
  query: string,
}

const POLICY: Record<string, Modifier | undefined> = {
  cjs: 'always',
  css: 'always',
  jpg: 'always',
  js: 'never',
  json: 'always',
  mjs: 'always',
  png: 'always',
  scss: 'always',
  sql: 'always',
  svg: 'always',
  ts: 'never',
  tsx: 'never',
}
const RESOLVE_EXTENSIONS = ['.mjs', '.cjs', '.js', '.json', '.node']
const DIRECTORY_PATTERN = /([\\/]|[\\/]?\.?\.)$/

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile()

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

const replaceImportPath = (sourceText: string, importPath: string): string => sourceText.replace(
  /^(['"])(.+)\1$/,
  (_match, quote: string) => `${quote}${importPath}${quote}`,
)

const getModifier = (extension: string): Modifier => POLICY[extension] ?? 'never'

export const importExtensions: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const directory = path.dirname(context.physicalFilename || context.filename)

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
      return base !== undefined && isBuiltin(base)
    }

    const isTypeOnly = (node: ESTree.Node): boolean => {
      const kind = node as { exportKind?: string, importKind?: string }
      return kind.importKind === 'type' || kind.exportKind === 'type'
    }

    const isResolvableWithoutExtension = (file: string): boolean => {
      const extension = path.extname(file)
      const withoutExtension = file.slice(0, -extension.length)
      return resolvePath(withoutExtension) === resolvePath(file)
    }

    const checkFileExtension = (source: ESTree.Literal, node: ESTree.Node): void => {
      if (!source.value || typeof source.value !== 'string') return

      const importPathWithQueryString = source.value
      if (isCoreModule(importPathWithQueryString)) return

      const { hash, pathname: importPath, query } = parsePath(importPathWithQueryString)
      if (isExternalRootModule(importPath)) return

      const resolvedPath = resolvePath(importPath)
      const extension = path.extname(resolvedPath ?? importPath).slice(1)
      const sourceText = context.sourceCode.getText(source)

      if (extension && importPath.endsWith(`.${extension}`)) {
        if (getModifier(extension) !== 'never') return
        if (!isResolvableWithoutExtension(importPath)) return
        const withoutExtension = importPath.slice(0, -(extension.length + 1))
        const pathname = withoutExtension.endsWith('/index') ? withoutExtension.slice(0, -6) : withoutExtension
        const fixedImportPath = stringifyPath({ hash, pathname, query })
        context.report({
          data: { extension, fixedImportPath, importPath: importPathWithQueryString },
          fix: fixer => fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath)),
          messageId: 'unexpected',
          node: source,
        })
        return
      }

      if (!extension || isTypeOnly(node) || getModifier(extension) !== 'always') return
      const pathname = DIRECTORY_PATTERN.test(importPath)
        ? `${importPath.endsWith('/') ? importPath.slice(0, -1) : importPath}/index.${extension}`
        : `${importPath}.${extension}`
      const fixedImportPath = stringifyPath({ hash, pathname, query })
      context.report({
        data: { extension, fixedImportPath, importPath: importPathWithQueryString },
        fix: fixer => fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath)),
        messageId: 'missingKnown',
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
      missingKnown: 'Missing file extension "{{extension}}" for "{{importPath}}"',
      unexpected: 'Unexpected use of file extension "{{extension}}" for "{{importPath}}"',
    },
    schema: [],
    type: 'suggestion',
  },
}
