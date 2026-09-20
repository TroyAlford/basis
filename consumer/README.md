# Consuming Basis

The Basis repository is the distribution artifact. There is no npm/JSR publish
step and no consumer build step: Bun resolves the source directly from a pinned
Git tag.

## Install

```bash
bun add --dev --trust github:TroyAlford/basis#vX.Y.Z
```

`--trust` records `basis` in the consumer's `trustedDependencies` so Basis's
install hook can apply the transitive patches Basis owns. The hook is
deterministic, idempotent, exact-version validated, and only touches packages
Basis declares. Consumers never copy patch files or `patchedDependencies`
entries.

Basis requires Bun `>=1.4.0`. Bun only honors root-level `patchedDependencies`,
which is why the trusted hook exists.

## ESLint

```js
// eslint.config.mjs
export { default } from 'basis/eslint'
```

`basis/eslint` is the shared flat config. Point the import resolver at a
different tsconfig or append local policy with the factory:

```js
// eslint.config.mjs
import { createConfig } from 'basis/eslint'

export default createConfig({
  tsconfig: './tsconfig.json',
  overrides: [{ files: ['src/index.ts'], rules: { 'no-console': 'off' } }],
})
```

Every ESLint plugin the config imports is declared by Basis itself, so consumers
do not enumerate or install the plugin stack.

## TypeScript

```json
{
  "extends": "basis/tsconfig/bun.json"
}
```

Presets: `basis/tsconfig/base.json`, `basis/tsconfig/bun.json`,
`basis/tsconfig/react.json`. They contain no Basis-monorepo path mappings.

## CLI

```bash
bunx basis doctor     # validate the surface and that owned patches are active
bunx basis lint
bunx basis typecheck
bunx basis check
```

## Patches

Patch files live in `patches/` and are declared in the root
`patchedDependencies` map, which is also the manifest the install hook reads.
The hook applies each `name@version` patch to every installed copy of that exact
version in the consumer graph. Unrelated versions are untouched and a missing
expected version fails the install loudly.
