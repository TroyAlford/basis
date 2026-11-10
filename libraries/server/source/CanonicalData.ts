import type { SQL as BunSQL } from 'bun'
import { DDL } from './Schema'

/**
 * Read the deterministic digest of canonical User/Role/UserRole data.
 * @param sql - Administrative connection.
 * @returns SHA-256 digest.
 */
export async function canonicalDataDigest(sql: BunSQL): Promise<string> {
  const users = await sql<{ data: unknown }[]>`
    SELECT to_jsonb(t) AS data
    FROM "User" t
    ORDER BY t."id"
  `
  const roles = await sql<{ data: unknown }[]>`
    SELECT to_jsonb(t) AS data
    FROM "Role" t
    ORDER BY t."id"
  `
  const userRoles = await sql<{ data: unknown }[]>`
    SELECT to_jsonb(t) AS data
    FROM "UserRole" t
    ORDER BY t."user.id", t."role.id"
  `
  return DDL.hash(JSON.stringify({
    roles: roles.map(row => row.data),
    userRoles: userRoles.map(row => row.data),
    users: users.map(row => row.data),
  }))
}
