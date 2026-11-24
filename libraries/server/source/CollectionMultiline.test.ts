import { describe, expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { sqlConcat, sqlFragment, sqlText } from './SQL'

/**
 * Build the multiline contract model.
 * @param via - Authored members collection path.
 * @returns Validated definitions.
 */
const model = (via: string) => EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'title', type: 'String' },
        {
          field: 'members',
          target: 'User',
          type: 'Collection',
          via,
        },
        {
          field: 'entries',
          target: 'WorkspaceAccess',
          type: 'Collection',
          via: 'WorkspaceAccess[workspace = @]',
        },
      ],
      name: 'Workspace',
    },
    {
      fields: [{ field: 'email', type: 'String' }],
      name: 'User',
    },
    { fields: [], name: 'Scope' },
  ],
  relationships: [{
    between: [
      { field: 'workspace', target: 'Workspace' },
      { field: 'user', target: 'User' },
      { field: 'scope', target: 'Scope' },
    ],
    fields: [
      { field: 'quantity', type: 'Number' },
      { field: 'label', type: 'String' },
    ],
    name: 'WorkspaceAccess',
  }],
}))

const singleLineVia =
  'WorkspaceAccess[workspace = @ $and quantity > 3].user'

const multilineVia = `
  WorkspaceAccess[
    workspace = @
    $and quantity > 3
  ].user
`

const definitions = model(singleLineVia)

/**
 * Compile one Workspace predicate.
 * @param where - Source predicate.
 * @returns Compiled query.
 */
const compile = (where: string) => compileEntityQuery(
  definitions,
  'Workspace',
  {
    fields: ['id'],
    where,
  },
)

describe('Graph multiline expression contract', () => {
  test('accepts idiomatic multiline collection predicates', () => {
    const where = `
      members $contains (
        id = $me
        $and workspaceAccess.quantity > 4
      )
    `

    expect(where).toMatchIndented(`
      members $contains (
        id = $me
        $and workspaceAccess.quantity > 4
      )
    `)

    const single = compile(
      'members $contains (id = $me $and workspaceAccess.quantity > 4)',
    )

    const multiline = compile(where)

    expect(multiline.sql).toMatchIndented(single.sql)
    expect(multiline.values).toEqual(single.values)
  })

  test('treats nested boolean expressions identically', () => {
    const single = compile(
      "members $contains ((email = 'alice@example.com' " +
      ' $or email = \'bob@example.com\') ' +
      ' $and workspaceAccess.quantity > 4)',
    )

    const multiline = compile(`
      members $contains (
        (
          email = 'alice@example.com'
          $or email = 'bob@example.com'
        )
        $and workspaceAccess.quantity > 4
      )
    `)

    expect(multiline.sql).toMatchIndented(single.sql)
    expect(multiline.values).toEqual(single.values)
  })

  test('accepts multiline authored via filters', () => {
    const single = model(singleLineVia)
    const multiline = model(multilineVia)

    const options = {
      fields: ['id', 'members.email'],
    }

    const expected = compileEntityQuery(single, 'Workspace', options)
    const actual = compileEntityQuery(multiline, 'Workspace', options)

    expect(actual.sql).toMatchIndented(expected.sql)
    expect(actual.values).toEqual(expected.values)
  })

  test('accepts CRLF as well as LF', () => {
    const lf = `
      members $contains (
        email = 'alice@example.com'
        $and workspaceAccess.quantity > 4
      )
    `

    const crlf = lf.replaceAll('\n', '\r\n')

    const expected = compile(lf)
    const actual = compile(crlf)

    expect(actual.sql).toMatchIndented(expected.sql)
    expect(actual.values).toEqual(expected.values)
  })

  test('does not normalize whitespace inside string literals', () => {
    const single = compile(
      "entries $contains (label = 'Alpha  Revised')",
    )

    const multiline = compile(`
      entries $contains (
        label = 'Alpha  Revised'
      )
    `)

    expect(multiline.sql).toMatchIndented(single.sql)
    expect(multiline.values).toEqual(single.values)
    expect(multiline.values).toContain('Alpha  Revised')

    const different = compile(`
      entries $contains (
        label = 'Alpha Revised'
      )
    `)

    expect(different.values).toContain('Alpha Revised')
    expect(different.values).not.toEqual(multiline.values)
  })

  test('does not turn SQL-looking string contents into syntax', () => {
    const payload = "Bolt' OR TRUE --"

    const compiled = compile(`
      entries $contains (
        label = "Bolt' OR TRUE --"
      )
    `)

    expect(compiled.sql).not.toContain(payload)
    expect(compiled.values).toContain(payload)
  })

  test('preserves escaped and quoted operator text', () => {
    const compiled = compile(`
      entries $contains (
        label = "$and $contains $empty"
      )
    `)

    expect(compiled.values).toContain('$and $contains $empty')
  })
})

describe('SQL fragment structural composition', () => {
  test('composes formatted fragments with ordered values', () => {
    const query = sqlConcat([
      sqlText('SELECT "id", "title"'),
      sqlText('FROM "Workspace"'),
      sqlFragment`WHERE "title" = ${"O'Brien"}`,
      sqlFragment`AND "id" != ${'excluded-id'}`,
    ], '\n')

    expect(query.sql).toMatchIndented(`
      SELECT "id", "title"
      FROM "Workspace"
      WHERE "title" = $1
      AND "id" != $2
    `)
    expect(query.values).toEqual(["O'Brien", 'excluded-id'])
  })

  test('keeps nested fragments and repeated values ordered', () => {
    const conditions = sqlConcat(
      Array.from({ length: 12 }, (_, index) => sqlFragment`"field${sqlText(String(index))}" = ${index}`),
      '\nAND ',
    )
    expect(conditions.sql).toMatchIndented(`
      "field0" = $1
      AND "field1" = $2
      AND "field2" = $3
      AND "field3" = $4
      AND "field4" = $5
      AND "field5" = $6
      AND "field6" = $7
      AND "field7" = $8
      AND "field8" = $9
      AND "field9" = $10
      AND "field10" = $11
      AND "field11" = $12
    `)
    expect(conditions.values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    const repeated = sqlFragment`"a" = ${'same'} OR "b" = ${'same'}`
    expect(sqlConcat([repeated]).values).toEqual(['same', 'same'])
  })

  test('never treats values, literals, comments, or dollar quotes as slots', () => {
    const payloads = [
      'x\'; DROP TABLE "Workspace"; --',
      '$1 $10 $100',
      "' OR TRUE --",
      "'); SELECT pg_sleep(10); --",
    ]
    const query = sqlConcat(
      payloads.map(value => sqlFragment`"title" = ${value}`),
      ' OR ',
    )
    expect(query.sql).toMatchIndented(`
      "title" = $1 OR "title" = $2 OR "title" = $3 OR "title" = $4
    `)
    expect(query.values).toEqual(payloads)
    for (const payload of payloads) expect(query.sql).not.toContain(payload)

    const literal = sqlFragment`SELECT '$1 ? -- /* */ $tag$ $$' /* $1 ? */`
    expect(literal.values).toEqual([])
    expect(literal.sql).toContain('$1 ?')
  })

  test('preserves quoted identifiers and multi-digit values', () => {
    const identifier = sqlText('"select"')
    const query = sqlConcat([
      sqlFragment`SELECT ${identifier} FROM ${sqlText('"from"')}`,
      sqlFragment`WHERE ${identifier} = ${10}`,
    ])
    expect(query.sql).toContain('SELECT "select" FROM "from"')
    expect(query.sql).toContain('"select" = $1')
  })
})
