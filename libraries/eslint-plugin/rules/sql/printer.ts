/* eslint-disable camelcase */
import type { Node } from 'libpg-query'
import type { SqlDoc } from './doc'
import { empty, printAlias, printExpression, printRangeFunction, printRangeSubselect, printRangeVar, printResTarget, printSortBy, printTypeName, printWindowDef } from './expressions'
import type { PlFunction } from './plpgsql'
import { printCreateFunctionStmt, printDoStmt } from './plpgsql'
import type { SourceText } from './source'
import { printAlterTableStmt, printColumnDef, printCommonTableExpr, printConstraint, printConstraintsSetStmt, printCreateSchemaStmt, printCreateSeqStmt, printCreateStmt, printCreateTrigStmt, printDelete, printDropStmt, printIndexElem, printIndexStmt, printInsert, printJoin, printSelect, printTransactionStmt, printUpdate, printVacuumStmt, printVariableSetStmt, printViewStmt } from './statements'
import { tagNode } from './types'

/** Everything a node printer needs to compose documents. */
export interface PrintContext {
  /** Create a child context for a separately parsed string (PL/pgSQL expressions). */
  readonly child: (source: SourceText) => PrintContext,
  /** Recursively print a protocol node. */
  readonly print: (node: Node) => SqlDoc,
  /** The source text the current AST was parsed from. */
  readonly source: SourceText,
  /** A statement printer must not consume comments beyond this source offset. */
  statementEnd: number,
  /** Consume the next PL/pgSQL function in source order. */
  readonly takePlFunction: () => PlFunction | undefined,
}

/**
 * Create a printer over a parsed SQL string.
 * @param source
 * @param plFunctions
 */
export function createPrinter(source: SourceText, plFunctions: readonly PlFunction[] = []): PrintContext {
  let plIndex = 0
  const context: PrintContext = {
    child: childSource => createPrinter(childSource),
    print: node => printNode(node, context),
    source,
    statementEnd: Number.POSITIVE_INFINITY,
    takePlFunction: () => {
      const fn = plFunctions[plIndex]
      plIndex += 1
      return fn
    },
  }
  return context
}

/**
 * Dispatch one protocol node to its printer.
 * @param node
 * @param ctx
 */
function printNode(node: Node, ctx: PrintContext): SqlDoc {
  const tagged = tagNode(node)
  switch (tagged.kind) {
    case 'SelectStmt': return printSelect(tagged.value, ctx)
    case 'InsertStmt': return printInsert(tagged.value, ctx)
    case 'UpdateStmt': return printUpdate(tagged.value, ctx)
    case 'DeleteStmt': return printDelete(tagged.value, ctx)
    case 'CreateStmt': return printCreateStmt(tagged.value, ctx)
    case 'AlterTableStmt': return printAlterTableStmt(tagged.value, ctx)
    case 'DropStmt': return printDropStmt(tagged.value)
    case 'IndexStmt': return printIndexStmt(tagged.value, ctx)
    case 'ViewStmt': return printViewStmt(tagged.value, ctx)
    case 'CreateSeqStmt': return printCreateSeqStmt(tagged.value, ctx)
    case 'CreateTrigStmt': return printCreateTrigStmt(tagged.value, ctx)
    case 'CreateSchemaStmt': return printCreateSchemaStmt(tagged.value)
    case 'VacuumStmt': return printVacuumStmt(tagged.value, ctx)
    case 'ConstraintsSetStmt': return printConstraintsSetStmt(tagged.value)
    case 'VariableSetStmt': return printVariableSetStmt(tagged.value, ctx)
    case 'TransactionStmt': return printTransactionStmt(tagged.value)
    case 'CreateFunctionStmt': return printCreateFunctionStmt(tagged.value, ctx)
    case 'DoStmt': return printDoStmt(tagged.value, ctx)

    case 'RangeVar': return printRangeVar(tagged.value, ctx)
    case 'RangeSubselect': return printRangeSubselect(tagged.value, ctx)
    case 'RangeFunction': return printRangeFunction(tagged.value, ctx)
    case 'JoinExpr': return printJoin(tagged.value, ctx)
    case 'Alias': return printAlias(tagged.value)
    case 'ResTarget': return printResTarget(tagged.value, ctx)
    case 'SortBy': return printSortBy(tagged.value, ctx)
    case 'ColumnDef': return printColumnDef(tagged.value, ctx)
    case 'Constraint': return printConstraint(tagged.value, ctx)
    case 'IndexElem': return printIndexElem(tagged.value, ctx)
    case 'CommonTableExpr': return printCommonTableExpr(tagged.value, ctx)
    case 'TypeName': return printTypeName(tagged.value, ctx)
    case 'WindowDef': return printWindowDef(tagged.value, ctx)
    case 'DefElem':
      return tagged.value.arg === undefined
        ? empty
        : ctx.print(tagged.value.arg)
    default:
      return printExpression(tagged, ctx)
  }
}
