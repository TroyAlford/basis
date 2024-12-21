import { $ } from 'bun'

/** The type of conventional commit */
export enum ChangeType {
  Build = 'build',
  CI = 'ci',
  Chore = 'chore',
  Docs = 'docs',
  Feat = 'feat',
  Fix = 'fix',
  Perf = 'perf',
  Refactor = 'refactor',
  Revert = 'revert',
  Style = 'style',
  Test = 'test',
  Unknown = 'unknown',
}

/** A parsed conventional commit message */
export interface ConventionalCommit {
  /** Whether this is a breaking change */
  breaking: boolean,
  /** The commit description (PR body) */
  description?: string,
  /** The optional scope */
  scope?: string,
  /** The commit title (without type prefix) */
  title: string,
  /** The commit type (feat, fix, etc.) */
  type: ChangeType,
}

/**
 * Get all commit messages since the last release tag
 * @returns Array of conventional commit messages
 */
export async function getUnreleasedCommitMessages(): Promise<ConventionalCommit[]> {
  try {
    await $`git fetch --tags origin`.quiet()

    // Get latest tag by version number (using proper semver sorting)
    const latestTag = await $`git tag | sort -V | tail -n 1`
      .quiet().nothrow().text().then(t => t.trim()).catch(() => '')

    // If no tag exists, get all commits
    const range = latestTag
      ? `${latestTag}..HEAD`
      : 'HEAD'

    /*
     * Get all commit messages since the last tag
     * Use %x1E as a commit separator and %x1F as a title/body separator
     */
    const output = await $`git log ${range} --format=%s%x1F%b%x1E`.text()
    const commits = output.split('\x1E').filter(Boolean).map(commit => {
      const [title, body = ''] = commit.split('\x1F')
      return { description: body.trim(), title: title.trim() }
    })

    // Parse conventional commits
    return commits.map(({ description, title }) => {
      // Match conventional commit pattern with named groups
      const match = title.match( // eslint-disable-next-line @stylistic/max-len
        /^(?<type>build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)/,
      )

      if (!match?.groups) {
        return {
          breaking: false,
          description: description || undefined,
          title,
          type: ChangeType.Unknown,
        }
      }

      const { scope, type } = match.groups
      const hasBreakingMarker = !!match.groups.breaking
      const hasBreakingComment = title.includes('BREAKING CHANGE') || description.includes('BREAKING CHANGE')

      return {
        breaking: hasBreakingMarker || hasBreakingComment,
        description: description || undefined,
        scope,
        title: match.groups.description,
        type: type as ChangeType,
      }
    })
  } catch {
    return []
  }
}

/**
 * Determines if a commit type should trigger a patch bump
 * @param type - The commit type
 * @returns Whether the commit type should trigger a patch bump
 */
export function isPatchChange(type: ChangeType): boolean {
  return [
    ChangeType.Chore,
    ChangeType.Fix,
    ChangeType.Refactor,
    ChangeType.Revert,
    ChangeType.Style,
  ].includes(type)
}

/**
 * Determines if a commit type should trigger a minor bump
 * @param type - The commit type
 * @returns Whether the commit type should trigger a minor bump
 */
export function isMinorChange(type: ChangeType): boolean {
  return [
    ChangeType.Feat,
    ChangeType.Perf,
  ].includes(type)
}

/**
 * Determines if a commit type should not trigger any bump
 * @param type - The commit type
 * @returns Whether the commit type should not trigger any bump
 */
export function isNoChange(type: ChangeType): boolean {
  return [
    ChangeType.Build,
    ChangeType.CI,
    ChangeType.Docs,
    ChangeType.Test,
    ChangeType.Unknown,
  ].includes(type)
}
