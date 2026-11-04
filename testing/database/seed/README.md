# Seeded PostgreSQL fixture

The large PostgreSQL E2E fixture is a prebuilt image instead of per-test data insertion.

- `generate.ts` emits the deterministic SQL used by the image.
- `seed.sql` is the committed generated SQL.
- `image.ts` hashes `Dockerfile` and `seed.sql`; the checksum is the immutable image tag.
- `Dockerfile` initializes a PostgreSQL data directory and loads the seed once during the image build.
- `withSeedDatabase` starts that image and connects to the `basis_seed` schema.

Regenerate SQL after changing the model:

```bash
bun testing/database/seed/generate.ts
```

Publish the immutable image through the `Database fixture image` workflow. Tests reuse an existing image for the same checksum and never insert the 500,000 rows at runtime.
