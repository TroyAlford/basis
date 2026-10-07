# Agent instructions

Guidance for humans and coding agents working in this repository.

## Git and branches

- **Do not push directly to `main`.** Create a feature branch from the latest `main` (`git checkout main && git pull && git checkout -b feat/your-topic`), commit there, and push that branch to open a pull request. Agents must not push to `main` or assume it is writable.

## Documentation

- **Keep docs in the same change as the code.** Whenever you add or change public API surface, default behavior, or user-visible component behavior, update the matching documentation page under `libraries/docs/pages/` (files named `*.docs.tsx`).
- **What counts:** new or renamed props, enum values, column types, static helpers on components, sorting or alignment rules, and similar contract changes.
- **Goal:** A reader browsing the docs app should see the current behavior without relying on the PR description alone.

## `@basis/react` components

- **Subclass `Component`.** UI in this package must be implemented as a `class` that extends `libraries/react/components/Component/Component.tsx` (or another basis component), using `displayName`, `get tag()`, `get attributes()`, `get classNames()`, and `content()` as appropriate. Do **not** add new functional components or use React hooks for package UI; match existing components (for example `Button`, `ApplicationBase`).
- **Styling.** Rely on `Component`’s automatic root class (`kebabCase(displayName)` plus `component`) and theme or layout CSS that targets those names. Do not introduce ad-hoc BEM-style blocks (`block__element--modifier`) on package components.

## Commits

- **Do not skip repository checks** when committing (for example `--no-verify` or other flags that bypass Husky). Let lint, typecheck, and tests run; fix failures instead of silencing hooks.

## CI and releases

- **Pull requests** to `main` run `.github/workflows/ci.yml` (ESLint, tests, TypeScript, and the consumer self-install contract). That workflow must pass before merge.
- **After merge to `main`**, `.github/workflows/release.yml` runs. It determines the next semantic version and creates a GitHub release and tag. Downstream repos (for example consumers pinning `github:…/basis#v…`) should use that tag.

## Consumer package surface

- The root `package.json` is the public facade for consumers. Keep `exports` limited to supported source/config entrypoints (`basis/cli`, `basis/configuration`, `basis/eslint`, `basis/logger`, `basis/markdown`, `basis/oauth`, `basis/react`, `basis/react/icons`, `basis/review`, `basis/server`, `basis/tsconfig/*`) and do not expose internal workspace paths.
- Basis has one import vocabulary: internal code imports the public surfaces by their consumer names (`basis/react`, `basis/server`, …), resolved locally by the root `tsconfig.json` `paths` remap, and imports internal-only workspaces (for example `@basis/utilities`) package-relatively. The published surface must still resolve through `exports` alone, without aliases, inside a consumer. Declare every external runtime dependency in the root `dependencies`.
- Public source must declare every dependency it imports in the root `dependencies`; consumers must not enumerate the ESLint plugin stack themselves.
- Patch files stay in `patches/` and are declared in the root `patchedDependencies` map. The trusted `postinstall` hook (`consumer/install.ts`) applies them to exact `name@version` installs with `git apply` (Bun cannot apply a dependency's patches transitively and exposes no standalone apply command). Do not reintroduce a hand-rolled diff applier; keep it deterministic, idempotent, and loud on drift. The same hook reads the consumer's `basis.hostDependencies`, resolves each declared non-npm capability on `PATH`, and probes the known ones with their version command; anything missing, present-but-broken, or malformed fails `bun install` loudly. Host dependencies are package metadata, never an imperative API.
- `bun run test:consumer` performs a real Git-dependency install into a temporary host app. Run it when changing `exports`, dependencies, presets, or patch handling.

## Repository documentation

- **Read before you change.** Read `README.md` and the durable documentation under `docs/` before planning or modifying code.
- **Invariants are constraints.** Treat documented architectural invariants as constraints. Current implementation may be transitional, legacy, or incorrect and does not override explicitly documented architectural intent.
- **Surface conflicts.** If a local change would move an ownership, security, lifecycle, deployment, or orchestration boundary, surface the conflict instead of silently changing it.
- **Canonical source.** Durable architecture, operational, developer, and consumer knowledge belongs under `docs/` as Markdown/MDX. Validate it with `basis docs check` (`bun run docs:check`). Directory names describe content, not publication mechanism.
