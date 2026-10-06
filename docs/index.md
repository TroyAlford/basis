---
title: Basis documentation
---

# Basis documentation

This directory is the canonical source for durable Basis documentation: plain Markdown (and MDX where interactivity is needed) that lives with the code and is independent of how it is published.

## Responsibilities

- **`README.md`** is the human and GitHub front door: what Basis is, how to consume it, and where to start.
- **`AGENTS.md`** is the coding-agent front door: it directs agents to read the README and this documentation before planning or changing code, and to treat documented invariants as constraints.
- **`docs/`** (this tree) holds durable architectural, operational, developer, and consumer knowledge. Directory names describe content, not publication mechanism.

## Layout

```text
docs/
  index.md
  architecture/
  contributing/
  guides/
  reference/
```

- [architecture/](./architecture/index.md) — the system's shape and the invariants that must not be broken silently.
- [contributing/](./contributing/index.md) — how to work in this repository.
- [guides/](./guides/index.md) — task-oriented guidance for consumers and maintainers.
- [reference/](./reference/index.md) — precise contracts and lookup material.

## Publication

The same source is projected to one or both targets without duplicating content: a Basis Server route (conventionally `/docs/*`) and a static build suitable for GitHub Pages. A repository may enable either, both, or neither while keeping this source organization. Validate the tree today with `basis docs check`.
