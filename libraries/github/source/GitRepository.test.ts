/* eslint-disable jsdoc/require-jsdoc */
import type { Shell } from 'bun'
import { beforeEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { GitRepository } from './GitRepository'

describe('GitRepository', () => {
  function createMockShell() {
    const calls: {
      command: string,
      cwdArg: string | null,
      envArg: Record<string, string> | null,
    }[] = []

    function mockShell(
      strings: TemplateStringsArray,
      ...args: string[]
    ) {
      const command = strings.reduce(
        (prev, curr, i) => prev + curr + (args[i] ?? ''),
        '',
      )
      const call = { command, cwdArg: null, envArg: null }
      calls.push(call)

      return {
        cwd(path: string) {
          call.cwdArg = path
          return this
        },
        env(envVars: Record<string, string>) {
          call.envArg = envVars
          return this
        },
      }
    }

    mockShell.getCalls = () => calls
    mockShell.reset = () => {
      calls.length = 0
    }

    return mockShell
  }

  const mockShell = createMockShell()

  const TEST_SSH_KEY = [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '# Your SSH private key content goes here',
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n')

  const REPOSITORY = 'git@github.com:your-username/your-test-repo.git' // Replace with your test repo
  const LOCAL_REPOSITORY_PATH = join(tmpdir(), `test_repo_${Date.now()}`)

  let repo: GitRepository

  beforeEach(() => {
    mockShell.reset()
    repo = new GitRepository({
      localPath: LOCAL_REPOSITORY_PATH,
      repoUrl: REPOSITORY,
      shell: mockShell as unknown as Shell,
      sshKey: TEST_SSH_KEY,
    })
  })

  test('should run git clone', async () => {
    await repo.clone()

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe(`git clone ${REPOSITORY} ${LOCAL_REPOSITORY_PATH}`)
    expect(call.cwdArg).toBeNull()
    expect(call.envArg).not.toBeNull()
  })

  test('should run git pull', async () => {
    await repo.pull()

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git pull')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
    expect(call.envArg).not.toBeNull()
  })

  test('should run git commit', async () => {
    const message = 'Test commit message'
    await repo.commit(message)

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(2)

    expect(calls[0].command).toBe('git add .')
    expect(calls[0].cwdArg).toBe(LOCAL_REPOSITORY_PATH)
    expect(calls[0].envArg).toBeNull()

    expect(calls[1].command).toBe(`git commit -m "${message}"`)
    expect(calls[1].cwdArg).toBe(LOCAL_REPOSITORY_PATH)
    expect(calls[1].envArg).toBeNull()
  })

  test('should run git push', async () => {
    await repo.push()

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git push')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
    expect(call.envArg).not.toBeNull()
  })
})
