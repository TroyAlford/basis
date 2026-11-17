import { scanProductionCorpus } from '../libraries/eslint-plugin/rules/sqlCorpus'
import { SQL_SCHEMA_VERSION, sqlCoverage } from '../libraries/eslint-plugin/rules/sqlCoverage'

const report = await scanProductionCorpus()
const coverage = sqlCoverage(report)
process.stdout.write(`SQL AST schema: ${SQL_SCHEMA_VERSION}\n`)
process.stdout.write(`Production corpus: ${coverage.corpusCovered} nodes; ${coverage.corpusPercent}% verified\n`)
process.stdout.write(`Pinned schema: ${coverage.schemaCovered} nodes; ${coverage.schemaPercent}% exercised\n`)
process.stdout.write(`Unresolved dynamic calls: ${report.unresolved.length}\n`)
