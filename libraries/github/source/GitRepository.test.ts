/* eslint-disable jsdoc/require-jsdoc */
import type { Shell, ShellOutput } from 'bun'
import { beforeEach, describe, expect, test } from 'bun:test'
import type { promises as FsPromises } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GitRepository } from './GitRepository'

describe('GitRepository', () => {
  interface ShellCall {
    command: string,
    cwdArg: string | null,
    envArg: Record<string, string> | null,
  }

  interface MockProcessPromise extends Promise<ShellOutput> {
    cwd(path: string): this,
    env(envVars: Record<string, string>): this,
  }

  interface MockShell extends Shell {
    getCalls: () => ShellCall[],
    reset: () => void,
  }

  function createMockShell(
    responses?: Record<string, { stdout: string }>,
  ): MockShell {
    const calls: ShellCall[] = []

    const mockShell = ((
      strings: TemplateStringsArray,
      ...args: string[]
    ): MockProcessPromise => {
      const command = strings.reduce(
        (prev, curr, i) => prev + curr + (args[i] ?? ''),
        '',
      )
      const call: ShellCall = { command, cwdArg: null, envArg: null }
      calls.push(call)

      const response = responses?.[command] || { stdout: '' }

      const processPromise: MockProcessPromise = Object.assign(
        Promise.resolve<ShellOutput>({
          exitCode: 0,
          stderr: Buffer.from(''),
          stdout: Buffer.from(response.stdout),
        } as ShellOutput),
        {
          cwd(path: string) {
            call.cwdArg = path
            return this
          },
          env(envVars: Record<string, string>) {
            call.envArg = envVars
            return this
          },
        },
      )

      return processPromise
    }) as unknown as MockShell

    mockShell.getCalls = () => calls
    mockShell.reset = () => {
      calls.length = 0
    }

    return mockShell
  }

  function createMockFs(): typeof FsPromises & {
    unlinkCalls: {
      path: string,
    }[],
    writeFileCalls: {
      data: string,
      options?: object,
      path: string,
    }[],
  } {
    const writeFileCalls: { data: string, options?: object, path: string }[]
      = []
    const unlinkCalls: { path: string }[] = []

    const mockFs = {
      unlink: async (path: string): Promise<void> => {
        unlinkCalls.push({ path })
        return Promise.resolve()
      },
      unlinkCalls,
      writeFile: async (
        path: string,
        data: string,
        options?: object,
      ): Promise<void> => {
        writeFileCalls.push({ data, options, path })
        return Promise.resolve()
      },
      writeFileCalls,
    }

    return mockFs as typeof FsPromises & {
      unlinkCalls: typeof unlinkCalls,
      writeFileCalls: typeof writeFileCalls,
    }
  }

  const TEST_SSH_KEY = [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '# Your SSH private key content goes here',
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n')

  const REPOSITORY = 'git@github.com:your-username/your-test-repo.git' // Replace with your test repo
  const LOCAL_REPOSITORY_PATH = join(tmpdir(), `test_repo_${Date.now()}`)

  let repo: GitRepository
  let mockShell: MockShell
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockShell = createMockShell()
    mockFs = createMockFs()

    repo = new GitRepository({
      fs: mockFs,
      localPath: LOCAL_REPOSITORY_PATH,
      repoUrl: REPOSITORY,
      shell: mockShell,
      sshKey: TEST_SSH_KEY,
    })
  })

  test('should run git clone', async () => {
    await repo.clone()

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe(
      `git clone ${REPOSITORY} ${LOCAL_REPOSITORY_PATH}`,
    )
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

  // New tests:

  test('should get git status', async () => {
    const expectedStatus = ' M modifiedFile.txt\nA  newFile.txt\n'
    mockShell = createMockShell({
      'git status --porcelain': { stdout: expectedStatus },
    })

    repo = new GitRepository({
      fs: mockFs,
      localPath: LOCAL_REPOSITORY_PATH,
      repoUrl: REPOSITORY,
      shell: mockShell,
      sshKey: TEST_SSH_KEY,
    })

    const status = await repo.getStatus()
    expect(status).toBe(expectedStatus)

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git status --porcelain')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })

  test('should get git diff', async () => {
    const expectedDiff = 'diff --git a/file.txt b/file.txt\n...'
    mockShell = createMockShell({
      'git diff': { stdout: expectedDiff },
    })

    repo = new GitRepository({
      fs: mockFs,
      localPath: LOCAL_REPOSITORY_PATH,
      repoUrl: REPOSITORY,
      shell: mockShell,
      sshKey: TEST_SSH_KEY,
    })

    const diff = await repo.getDiff()
    expect(diff).toBe(expectedDiff)

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git diff')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })

  test('should stage a file', async () => {
    await repo.stageFile('file.txt')

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git add -- file.txt')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })

  test('should unstage a file', async () => {
    await repo.unstageFile('file.txt')

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git reset -- file.txt')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })

  test('should revert a file', async () => {
    await repo.revertFile('file.txt')

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toBe('git checkout -- file.txt')
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })

  test('should stage a patch', async () => {
    const patchContent = 'diff --git a/file.txt b/file.txt\n...'
    await repo.stagePatch(patchContent)

    expect(mockFs.writeFileCalls.length).toBe(1)
    expect(mockFs.unlinkCalls.length).toBe(1)

    const writeFileCall = mockFs.writeFileCalls[0]
    expect(writeFileCall.data).toBe(patchContent)

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toMatch(/git apply --cached .+\.diff/)
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })

  test('should unstage a patch', async () => {
    const patchContent = 'diff --git a/file.txt b/file.txt\n...'
    await repo.unstagePatch(patchContent)

    expect(mockFs.writeFileCalls.length).toBe(1)
    expect(mockFs.unlinkCalls.length).toBe(1)

    const writeFileCall = mockFs.writeFileCalls[0]
    expect(writeFileCall.data).toBe(patchContent)

    const calls = mockShell.getCalls()
    expect(calls.length).toBe(1)
    const call = calls[0]
    expect(call.command).toMatch(/git apply --reverse --cached .+\.diff/)
    expect(call.cwdArg).toBe(LOCAL_REPOSITORY_PATH)
  })
})
