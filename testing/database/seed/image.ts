import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Schema populated by the prebuilt PostgreSQL fixture image. */
export const SEED_SCHEMA = 'basis_seed'
/** Default GHCR repository for the prebuilt database fixture. */
export const DEFAULT_SEED_IMAGE = 'ghcr.io/troyalford/basis-postgres-test'

/**
 * Compute the deterministic checksum of the database image inputs.
 * @returns A short SHA-256 tag suffix.
 */
export function seedChecksum(): string {
  const directory = import.meta.dir
  const hash = createHash('sha256')
  for (const file of ['Dockerfile', 'seed.sql']) {
    hash.update(readFileSync(join(directory, file)))
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * Resolve the complete image reference used by tests and image publishing.
 * @returns An immutable GHCR image reference.
 */
export function seedImage(): string {
  return `${process.env.BASIS_SEED_IMAGE_REPOSITORY ?? DEFAULT_SEED_IMAGE}:sha-${seedChecksum()}`
}

if (import.meta.main) process.stdout.write(`${seedImage()}\n`)
