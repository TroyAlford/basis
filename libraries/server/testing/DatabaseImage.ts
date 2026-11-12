import { runAsync } from 'basis/configuration'
import { join } from 'node:path'
import { SEED_DIRECTORY, seedImage } from '../../../testing/database/seed/image'

/**
 * Ensure the immutable seeded PostgreSQL image exists locally.
 *
 * The image is pulled when published and built only when the committed fixture
 * inputs changed and no registry copy exists for that checksum.
 * @param image - Immutable image reference.
 * @returns The resolved image reference.
 */
export async function ensureSeedImage(image = seedImage()): Promise<string> {
  const local = await runAsync('docker', ['image', 'inspect', image])
  if (local.exitCode === 0) return image
  const pulled = await runAsync('docker', ['pull', image])
  if (pulled.exitCode === 0) return image
  const built = await runAsync('docker', [
    'build',
    '--file',
    join(SEED_DIRECTORY, 'Dockerfile'),
    '--tag',
    image,
    SEED_DIRECTORY,
  ])
  if (built.exitCode !== 0) {
    throw new Error(`Seeded PostgreSQL fixture could not be pulled or built: ${built.stderr.trim()}`)
  }
  return image
}
