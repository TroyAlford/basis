# @basis/workspaces

Internal workspace-management CLI for the Basis monorepo. It is not a supported consumer package and is not installed from npm or JSR.

The authoritative reference is the documentation site's [Workspaces page](../../docs/workspaces.mdx). This README is an internal maintainer front door.

The package provides the `workspace` / `ws` binary used by root development scripts. Typical maintainer commands:

```bash
bun run workspace list
bun run workspace build @basis/utilities
bun run workspace build-all
bun run workspace changed
```

Commands cover workspace discovery, filtered builds, dependency and changed-file tracking, and license handling. See the [Workspaces page](../../docs/workspaces.mdx) for the supported descriptions and audience.
