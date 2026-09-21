/* eslint-disable @basis/no-default-export */
import { importExtensions } from './importExtensions'
import { noMixedTypeImports } from './no-mixed-type-imports'
import { noObjectPadding } from './no-object-padding'
import { noDefaultExport } from './noDefaultExport'
import { noExtraneousDependencies } from './noExtraneousDependencies'
import { sortInterface } from './sortInterface'
import { sortKeys } from './sortKeys'
import { sortStringEnum } from './sortStringEnum'

export default {
  rules: {
    'import-extensions': importExtensions,
    'no-default-export': noDefaultExport,
    'no-extraneous-dependencies': noExtraneousDependencies,
    'no-mixed-type-imports': noMixedTypeImports,
    'no-object-padding': noObjectPadding,
    'sort-interface': sortInterface,
    'sort-keys': sortKeys,
    'sort-string-enum': sortStringEnum,
  },
}
