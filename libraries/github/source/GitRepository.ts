// src/GitRepository.ts
import type { Shell } from 'bun'
import { $ } from 'bun'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface GitRepositoryOptions {
  localPath: string, // SSH private key as a string
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

  constructor(options: GitRepositoryOptions) {
    this.sshKey = options.sshKey
    this.repoUrl = options.repoUrl
    this.localPath = options.localPath
    this.sshKeyPath = ''
    this.shell = options.shell || $
  }

  private async setupSSHKey() {
    const tempDir = tmpdir()
    this.sshKeyPath = join(tempDir, `temp_ssh_key_${Date.now()}`)
    await fs.writeFile(this.sshKeyPath, this.sshKey, { mode: 0o600 })
  }

  private async cleanupSSHKey() {
    if (this.sshKeyPath) await fs.unlink(this.sshKeyPath)
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
      await this.shell`git clone ${this.repoUrl} ${this.localPath}`.env(this.getEnv())
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
}
