/* eslint-disable @basis/no-default-export */
import pluginStylistic from '@stylistic/eslint-plugin'
import { componentArchitecture } from './componentArchitecture'
import { entityDefinitionFormat } from './entityDefinitionFormat'
import { importExtensions } from './importExtensions'
import { noMixedTypeImports } from './no-mixed-type-imports'
import { noObjectPadding } from './no-object-padding'
import { noAlternativeScreenshots } from './noAlternativeScreenshots'
import { noAlternativeTestRenderer } from './noAlternativeTestRenderer'
import { noCommittedTestDatabaseWrite } from './noCommittedTestDatabaseWrite'
import { noCustomDatabaseFixture } from './noCustomDatabaseFixture'
import { noCustomTestLifecycle } from './noCustomTestLifecycle'
import { noCustomTestServer } from './noCustomTestServer'
import { noCustomTestTempRoot } from './noCustomTestTempRoot'
import { noDefaultExport } from './noDefaultExport'
import { noDirectApplicationNavigation } from './noDirectApplicationNavigation'
import { noDirectBrowserLifecycle } from './noDirectBrowserLifecycle'
import { noDirectProcessSpawn } from './noDirectProcessSpawn'
import { noDirectTestingInternals } from './noDirectTestingInternals'
import { noExtraneousDependencies } from './noExtraneousDependencies'
import { noJsxLineBreaks } from './noJsxLineBreaks'
import { noJsxSpaceInjection } from './noJsxSpaceInjection'
import { noTestDatabaseIsolationFramework } from './noTestDatabaseIsolationFramework'
import { sortInterface } from './sortInterface'
import { sortJsxProps } from './sortJsxProps'
import { sortKeys } from './sortKeys'
import { sortStringEnum } from './sortStringEnum'
import { sqlIdentifierStyle } from './sqlIdentifierStyle'
import { sqlTemplateFormat } from './sqlTemplateFormat'
import { sqlTemplateValidity } from './sqlTemplateValidity'
import { transactionSqlName } from './transactionSqlName'

export default {
  rules: {
    'component-architecture': componentArchitecture,
    'entity-definition-format': entityDefinitionFormat,
    'eol-last': pluginStylistic.rules['eol-last'],
    'function-paren-newline': pluginStylistic.rules['function-paren-newline'],
    'import-extensions': importExtensions,
    'no-alternative-screenshots': noAlternativeScreenshots,
    'no-alternative-test-renderer': noAlternativeTestRenderer,
    'no-committed-test-database-write': noCommittedTestDatabaseWrite,
    'no-custom-database-fixture': noCustomDatabaseFixture,
    'no-custom-test-lifecycle': noCustomTestLifecycle,
    'no-custom-test-server': noCustomTestServer,
    'no-custom-test-temp-root': noCustomTestTempRoot,
    'no-default-export': noDefaultExport,
    'no-direct-application-navigation': noDirectApplicationNavigation,
    'no-direct-browser-lifecycle': noDirectBrowserLifecycle,
    'no-direct-process-spawn': noDirectProcessSpawn,
    'no-direct-testing-internals': noDirectTestingInternals,
    'no-extraneous-dependencies': noExtraneousDependencies,
    'no-jsx-line-breaks': noJsxLineBreaks,
    'no-jsx-space-injection': noJsxSpaceInjection,
    'no-mixed-type-imports': noMixedTypeImports,
    'no-object-padding': noObjectPadding,
    'no-test-database-isolation-framework': noTestDatabaseIsolationFramework,
    'sort-interface': sortInterface,
    'sort-jsx-props': sortJsxProps,
    'sort-keys': sortKeys,
    'sort-string-enum': sortStringEnum,
    'sql-identifier-style': sqlIdentifierStyle,
    'sql-template-format': sqlTemplateFormat,
    'sql-template-valid': sqlTemplateValidity,
    'transaction-sql-name': transactionSqlName,
  },
}
