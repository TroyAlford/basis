// src/GitRepository.ts
import type { Shell } from 'bun'
import { $ } from 'bun'
import type { promises as FsPromises } from 'fs'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface GitRepositoryOptions {
  fs?: typeof FsPromises,
  localPath: string,
  repoUrl: string,
  shell?: Shell,
  sshKey: string,
}

export class GitRepository {
  private sshKey: string
  private repoUrl: string
  private localPath: string
  private sshKeyPath: string
  private shell: Shell
  private fs: typeof FsPromises

  constructor(options: GitRepositoryOptions) {
    this.sshKey = options.sshKey
    this.repoUrl = options.repoUrl
    this.localPath = options.localPath
    this.sshKeyPath = ''
    this.shell = options.shell || $
    this.fs = options.fs || fs
  }

  private async setupSSHKey() {
    const tempDir = tmpdir()
    this.sshKeyPath = join(tempDir, `temp_ssh_key_${Date.now()}`)
    await this.fs.writeFile(this.sshKeyPath, this.sshKey, { mode: 0o600 })
  }

  private async cleanupSSHKey() {
    if (this.sshKeyPath) await this.fs.unlink(this.sshKeyPath)
  }

  private getEnv() {
    return {
      ...process.env,
      GIT_SSH_COMMAND: `ssh -i "${this.sshKeyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no`,
    }
  }

  public async clone(): Promise<void> {
    await this.setupSSHKey()
    try {
      await this.shell`git clone ${this.repoUrl} ${this.localPath}`.env(
        this.getEnv(),
      )
    } catch (error) {
      throw new Error(`Git clone failed: ${error}`)
    } finally {
      await this.cleanupSSHKey()
    }
  }

  public async pull(): Promise<void> {
    await this.setupSSHKey()
    try {
      await this.shell`git pull`.cwd(this.localPath).env(this.getEnv())
    } catch (error) {
      throw new Error(`Git pull failed: ${error}`)
    } finally {
      await this.cleanupSSHKey()
    }
  }

  public async commit(message: string): Promise<void> {
    try {
      await this.shell`git add .`.cwd(this.localPath)
      await this.shell`git commit -m "${message}"`.cwd(this.localPath)
    } catch (error) {
      throw new Error(`Git commit failed: ${error}`)
    }
  }

  public async push(): Promise<void> {
    await this.setupSSHKey()
    try {
      await this.shell`git push`.cwd(this.localPath).env(this.getEnv())
    } catch (error) {
      throw new Error(`Git push failed: ${error}`)
    } finally {
      await this.cleanupSSHKey()
    }
  }

  // New methods:

  public async getStatus(): Promise<string> {
    try {
      const result = await this.shell`git status --porcelain`.cwd(this.localPath)
      return result.stdout?.toString() || ''
    } catch (error) {
      throw new Error(`Git status failed: ${error}`)
    }
  }

  public async getDiff(filePath?: string): Promise<string> {
    try {
      const command = filePath ? `git diff -- ${filePath}` : 'git diff'
      const result = await this.shell`${command}`.cwd(this.localPath)
      return result.stdout?.toString() || ''
    } catch (error) {
      throw new Error(`Git diff failed: ${error}`)
    }
  }

  public async stageFile(filePath: string): Promise<void> {
    try {
      await this.shell`git add -- ${filePath}`.cwd(this.localPath)
    } catch (error) {
      throw new Error(`Git add failed: ${error}`)
    }
  }

  public async unstageFile(filePath: string): Promise<void> {
    try {
      await this.shell`git reset -- ${filePath}`.cwd(this.localPath)
    } catch (error) {
      throw new Error(`Git reset failed: ${error}`)
    }
  }

  public async revertFile(filePath: string): Promise<void> {
    try {
      await this.shell`git checkout -- ${filePath}`.cwd(this.localPath)
    } catch (error) {
      throw new Error(`Git checkout failed: ${error}`)
    }
  }

  public async stagePatch(patchContent: string): Promise<void> {
    const tempDir = tmpdir()
    const patchPath = join(tempDir, `temp_patch_${Date.now()}.diff`)
    try {
      await this.fs.writeFile(patchPath, patchContent)
      await this.shell`git apply --cached ${patchPath}`.cwd(this.localPath)
    } catch (error) {
      throw new Error(`Git apply failed: ${error}`)
    } finally {
      await this.fs.unlink(patchPath)
    }
  }

  public async unstagePatch(patchContent: string): Promise<void> {
    const tempDir = tmpdir()
    const patchPath = join(tempDir, `temp_patch_${Date.now()}.diff`)
    try {
      await this.fs.writeFile(patchPath, patchContent)
      await this.shell`git apply --reverse --cached ${patchPath}`.cwd(
        this.localPath,
      )
    } catch (error) {
      throw new Error(`Git reverse apply failed: ${error}`)
    } finally {
      await this.fs.unlink(patchPath)
    }
  }
}
