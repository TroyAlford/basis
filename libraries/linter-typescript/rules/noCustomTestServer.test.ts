import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'

const lint = (code: string) => lintRule('noCustomTestServer', code, 'fixture.test.ts')
const lintApplication = (code: string) => lintRule('noCustomTestServer', code, 'fixture.e2e.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCustomTestServer')
  expect(messages[0]?.message).toContain('useApplication')
}

const expectsApplicationReport = (code: string): void => {
  const messages = lintApplication(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCustomTestServer')
  expect(messages[0]?.message).toContain('useApplication')
}

const expectsDatabaseReport = (code: string): void => {
  const messages = lintApplication(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCustomTestDatabase')
  expect(messages[0]?.message).toContain('withDatabase')
}

describe('noCustomTestServer', () => {
  test('reports a Basis Server in an application test', () => {
    expectsApplicationReport("import { Server } from 'basis/server'\nnew Server()")
  })

  test('reports an aliased Basis Server in an application test', () => {
    expectsApplicationReport(
      "import { Server as AppServer } from 'basis/server'\nnew AppServer()",
    )
  })

  test('reports a relative Basis Server in an application test', () => {
    expectsApplicationReport("import { Server } from './Server'\nnew Server().database()")
  })

  test('reports a default Basis Server in an application test', () => {
    expectsApplicationReport("import Server from './Server'\nnew Server().database().start({ port: 0 })")
  })

  test('reports a Basis Server assigned before database configuration', () => {
    expectsApplicationReport(
      "import { Server } from 'basis/server'\nconst server = new Server()\nserver.database()",
    )
  })

  test('reports a direct managed database provisioner in an application test', () => {
    expectsDatabaseReport(
      "import { createDatabase } from './Database'\ncreateDatabase({ authorization: true })",
    )
  })

  test('reports a direct managed Postgres service in an application test', () => {
    expectsDatabaseReport(
      "import { ManagedPostgresService } from './ManagedPostgresService'\nnew ManagedPostgresService()",
    )
  })

  test('allows a Basis Server in a unit test', () => {
    expect(lint("import { Server } from 'basis/server'\nnew Server()")).toHaveLength(0)
  })

  test('reports Bun.serve', () => {
    expectsReport('Bun.serve({ fetch: () => new Response(\'ok\') })')
  })

  test('reports a bracketed Bun.serve', () => {
    expectsReport('Bun[\'serve\']({ fetch: () => new Response(\'ok\') })')
  })

  test('reports an aliased Bun.serve', () => {
    expectsReport('const serve = Bun.serve\nserve({ fetch: () => new Response(\'ok\') })')
  })

  test('reports destructured Bun.serve', () => {
    expectsReport('const { serve } = Bun\nserve({ fetch: () => new Response(\'ok\') })')
  })

  test('reports a named http createServer', () => {
    expectsReport('import { createServer } from \'node:http\'\ncreateServer()')
  })

  test('reports an aliased createServer', () => {
    expectsReport('import { createServer as serve } from \'http\'\nserve()')
  })

  test('reports a namespace https createServer', () => {
    expectsReport('import * as https from \'node:https\'\nhttps.createServer()')
  })

  test('reports http2 createSecureServer', () => {
    expectsReport('import { createSecureServer } from \'node:http2\'\ncreateSecureServer()')
  })

  test('reports net.createServer', () => {
    expectsReport('import * as net from \'node:net\'\nnet.createServer()')
  })

  test('reports a manual server launcher through Bun.spawn', () => {
    expectsReport('Bun.spawn([\'bun\', \'./server.ts\'])')
  })

  test('reports a manual server launcher through runAsync', () => {
    expectsReport('import { runAsync } from \'basis/utilities\'\nrunAsync(\'bun\', [\'run\', \'start\'])')
  })

  test('reports a manual dev server launcher through run', () => {
    expectsReport('import { run } from \'basis/utilities\'\nrun`bun run dev`')
  })

  test('reports a port-bound launcher', () => {
    expectsReport('Bun.spawn([\'bun\', \'./scripts/start.ts\', \'--port\', \'3000\'])')
  })

  test('allows an ordinary test command', () => {
    expect(lint('Bun.spawn([\'bun\', \'test\', \'./server.test.ts\'])')).toHaveLength(0)
  })

  test('allows an ordinary Basis runner command', () => {
    expect(lint('import { run } from \'basis/utilities\'\nrun(\'git\', [\'status\'])')).toHaveLength(0)
  })

  test('allows a build script', () => {
    expect(lint('Bun.spawn([\'bun\', \'./scripts/build.ts\'])')).toHaveLength(0)
  })

  test('allows a container port publish', () => {
    expect(lint('Bun.spawn([\'docker\', \'run\', \'-p\', \'127.0.0.1::5432\', \'postgres\'])')).toHaveLength(0)
  })
})
