import { SQL_SCHEMA_VERSION, sqlCoverage } from '../libraries/eslint-plugin/rules/sqlCoverage'

const coverage = sqlCoverage()
process.stdout.write(`SQL AST schema: ${SQL_SCHEMA_VERSION}\n`)
process.stdout.write(`Production corpus: ${coverage.corpusCovered}/${coverage.corpusPercent}%\n`)
process.stdout.write(`Pinned schema: ${coverage.schemaCovered}/${coverage.schemaPercent}%\n`)
