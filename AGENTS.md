# Agent instructions

Guidance for humans and coding agents working in this repository.

## Documentation

- **Keep docs in the same change as the code.** Whenever you add or change public API surface, default behavior, or user-visible component behavior, update the matching documentation page under `libraries/docs/pages/` (files named `*.docs.tsx`).
- **What counts:** new or renamed props, enum values, column types, static helpers on components, sorting or alignment rules, and similar contract changes.
- **Goal:** A reader browsing the docs app should see the current behavior without relying on the PR description alone.

## Commits

- **Do not skip repository checks** when committing (for example `--no-verify` or other flags that bypass Husky). Let lint, typecheck, and tests run; fix failures instead of silencing hooks.

## CI and releases

- **Pull requests** to `main` run `.github/workflows/ci.yml` (ESLint, tests, TypeScript). That workflow must pass before merge.
- **After merge to `main`**, `.github/workflows/release.yml` runs. It determines the next semantic version and creates a GitHub release and tag. Downstream repos (for example consumers pinning `github:…/basis#v…`) should use that tag.
