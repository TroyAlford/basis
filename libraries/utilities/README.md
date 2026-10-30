# @basis/utilities

Internal workspace of shared functions and types used by Basis packages. It is not a supported consumer import; consumers use supported surfaces such as `basis/logger`, `basis/react`, `basis/configuration`, and `basis/server`.

The authoritative map of the internal surface is the documentation site's [Utilities page](../../docs/utilities.mdx). It covers string/naming helpers, formatting, object/path primitives, async primitives, URI/routing helpers, runtime facts, and the exported types.

```ts
kebabCase('MoonPhase') // 'moon-phase'
formatBytes(1024) // '1.00 KB'
```

`Logger` is available here internally and through its supported facade, `basis/logger`. See [Logging](../../docs/logging.mdx) for the public contract.

Internal Basis code imports this workspace package-relatively; applications must not depend on `@basis/utilities` or `node_modules/basis/libraries/*` paths.
