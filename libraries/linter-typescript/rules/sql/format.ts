import { createFromBuffer } from '@dprint/formatter'
import { getBuffer } from '@dprint/sql'

/** Canonical dprint configuration for Basis SQL templates. */
export const SQL_FORMAT_CONFIG = {
  casing: 'upper',
  dialect: 'postgresql',
  indentWidth: 2,
  joinsAsTopLevel: true,
  lineWidth: 100,
  linesBetweenQueries: 2,
} as const

const formatter = createFromBuffer(getBuffer())

formatter.setConfig(
  {
    indentWidth: SQL_FORMAT_CONFIG.indentWidth,
    lineWidth: SQL_FORMAT_CONFIG.lineWidth,
    newLineKind: 'lf',
    useTabs: false,
  },
  SQL_FORMAT_CONFIG,
)

/** Format one SQL template body with dprint. */
export function formatSQL(sql: string): string {
  return formatter.formatText({ filePath: 'template.sql', fileText: sql })
}
