import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { consumerToolchainUnsupportedReason } from './toolchain'

const config = `[settings]
npm.package_manager = "npm"

[tools."npm:bun"]
version = "1.4.5-canary.20261121.1"
allow_builds = true
npm_args = "--include=optional --ignore-scripts=false"
`

/**
 * Create a temporary consumer root.
 * @returns The root and cleanup function.
 */
function fixture() {
  const root = tempDirectory('basis-toolchain-')
  mkdirSync(root, { recursive: true })
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    root,
  }
}

describe('consumer toolchain validation', () => {
  test('accepts the canonical mise npm Bun configuration', () => {
    const { cleanup, root } = fixture()
    try {
      writeFileSync(join(root, 'mise.toml'), config)
      expect(consumerToolchainUnsupportedReason(root)).toBeNull()
      writeFileSync(join(root, 'mise.toml'), config.replace('1.4.5-canary.20261121.1', '1.4.6'))
      expect(consumerToolchainUnsupportedReason(root)).toBeNull()
    } finally {
      cleanup()
    }
  })

  test('rejects legacy .tool-versions and a missing mise.toml', () => {
    const legacy = fixture()
    try {
      writeFileSync(join(legacy.root, '.tool-versions'), 'bun 1.4.5\n')
      expect(consumerToolchainUnsupportedReason(legacy.root)).toContain('not')
      expect(consumerToolchainUnsupportedReason(legacy.root)).toContain('.tool-versions')
    } finally {
      legacy.cleanup()
    }

    const missing = fixture()
    try {
      expect(consumerToolchainUnsupportedReason(missing.root)).toContain('requires')
      expect(consumerToolchainUnsupportedReason(missing.root)).toContain('mise.toml')
    } finally {
      missing.cleanup()
    }
  })

  test('rejects a non-npm installer and an unsupported version', () => {
    const aube = fixture()
    try {
      writeFileSync(join(aube.root, 'mise.toml'), config.replace('"npm"', '"aube"'))
      expect(consumerToolchainUnsupportedReason(aube.root)).toContain('npm.package_manager')
    } finally {
      aube.cleanup()
    }

    const old = fixture()
    try {
      writeFileSync(join(old.root, 'mise.toml'), config.replace('1.4.5-canary.20261121.1', '1.4.4'))
      expect(consumerToolchainUnsupportedReason(old.root)).toContain('must pin')
    } finally {
      old.cleanup()
    }

    const missingBuilds = fixture()
    try {
      writeFileSync(join(missingBuilds.root, 'mise.toml'), config.replace('allow_builds = true\n', ''))
      expect(consumerToolchainUnsupportedReason(missingBuilds.root)).toContain('allow_builds')
    } finally {
      missingBuilds.cleanup()
    }

    const missingArgs = fixture()
    try {
      writeFileSync(
        join(missingArgs.root, 'mise.toml'),
        config.replace('npm_args = "--include=optional --ignore-scripts=false"\n', ''),
      )
      expect(consumerToolchainUnsupportedReason(missingArgs.root)).toContain('npm_args')
    } finally {
      missingArgs.cleanup()
    }
  })

  test('rejects malformed and incomplete mise.toml', () => {
    const malformed = fixture()
    try {
      writeFileSync(join(malformed.root, 'mise.toml'), '[tools\n')
      expect(consumerToolchainUnsupportedReason(malformed.root)).toContain('not valid TOML')
    } finally {
      malformed.cleanup()
    }

    const incomplete = fixture()
    try {
      writeFileSync(join(incomplete.root, 'mise.toml'), '[settings]\nnpm.package_manager = "npm"\n')
      expect(consumerToolchainUnsupportedReason(incomplete.root)).toContain('npm:bun')
    } finally {
      incomplete.cleanup()
    }
  })
})
