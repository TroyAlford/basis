/* eslint-disable @basis/no-default-export */
import pluginStylistic from '@stylistic/eslint-plugin'
import { importExtensions } from './importExtensions'
import { noMixedTypeImports } from './no-mixed-type-imports'
import { noObjectPadding } from './no-object-padding'
import { noDefaultExport } from './noDefaultExport'
import { noExtraneousDependencies } from './noExtraneousDependencies'
import { noJsxLineBreaks } from './noJsxLineBreaks'
import { noJsxSpaceInjection } from './noJsxSpaceInjection'
import { sortInterface } from './sortInterface'
import { sortJsxProps } from './sortJsxProps'
import { sortKeys } from './sortKeys'
import { sortStringEnum } from './sortStringEnum'

export default {
  rules: {
    'eol-last': pluginStylistic.rules['eol-last'],
    'function-paren-newline': pluginStylistic.rules['function-paren-newline'],
    'import-extensions': importExtensions,
    'no-default-export': noDefaultExport,
    'no-extraneous-dependencies': noExtraneousDependencies,
    'no-jsx-line-breaks': noJsxLineBreaks,
    'no-jsx-space-injection': noJsxSpaceInjection,
    'no-mixed-type-imports': noMixedTypeImports,
    'no-object-padding': noObjectPadding,
    'sort-interface': sortInterface,
    'sort-jsx-props': sortJsxProps,
    'sort-keys': sortKeys,
    'sort-string-enum': sortStringEnum,
  },
}
