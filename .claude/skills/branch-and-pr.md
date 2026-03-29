# branch-and-pr

Use this skill when asked to create a branch, commit, or pull request.

## Convco Commit Types

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change that is neither a fix nor a feature |
| `test` | Adding or correcting tests |
| `docs` | Documentation only |
| `chore` | Build process, dependencies, tooling |
| `perf` | Performance improvement |
| `ci` | CI/CD changes |

## Branch Names

Format: `{type}/{short-kebab-description}`

Examples:
- `feat/db-backup-and-restore`
- `fix/backup-dir-permissions`
- `refactor/schema-bootstrap-phases`

## Commit Messages

Format: `{type}({scope}): {short description}`

- Scope is optional but preferred when the change is clearly scoped to one area
- Description is lowercase, imperative mood, no trailing period
- Body is optional; use it only for non-obvious context

Examples:
- `feat(db): add pg_dump backup and restore via docker exec`
- `fix(backup): use relative path for BACKUP_DIR default`
- `refactor(schema): split bootstrap into extensions/tables/views phases`

## Pull Request Titles

Same format as commit messages: `{type}({scope}): {short description}`

## Pull Request Bodies

- **Terse and focused** — what changed and why, not how
- Use a short bullet list for the summary (3–5 bullets max)
- No implementation details, no code walkthroughs
- Include a test plan checklist

Template:
```
## Summary
- {what changed, one line per logical unit}
- {why it was needed or what problem it solves}

## Test plan
- [ ] {key thing to verify manually or via tests}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Workflow

1. Determine the convco type and scope from the changes
2. Create the branch: `git checkout -b {type}/{description}`
3. Stage and commit with a convco message
4. Push and open the PR with a convco title and terse body
