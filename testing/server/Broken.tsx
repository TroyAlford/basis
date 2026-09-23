/*
 * Intentional build failure for the readiness fixture. The unresolved import
 * makes `Bun.build` fail while still typechecking here.
 */
// @ts-expect-error - the module does not exist on purpose.
import { missing } from './does-not-exist'

export const broken = missing
