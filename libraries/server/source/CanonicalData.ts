import type { SQL as BunSQL } from 'bun'
import { checksum } from '@basis/utilities'

/**
 * Read the deterministic digest of canonical User/Role/UserRole data.
 * @param sql - Administrative connection.
 * @returns SHA-256 digest.
 */
export async function canonicalDataDigest(sql: BunSQL): Promise<string> {
  const users = await sql<Record<string, unknown>[]>`
    SELECT *
    FROM "User" t
    ORDER BY t."id"
  `
  const roles = await sql<Record<string, unknown>[]>`
    SELECT *
    FROM "Role" t
    ORDER BY t."id"
  `
  const userRoles = await sql<Record<string, unknown>[]>`
    SELECT *
    FROM "UserRole" t
    ORDER BY t."user.id", t."role.id"
  `
  return checksum({ roles, userRoles, users })
}
