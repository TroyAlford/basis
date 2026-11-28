/**
 * Consumer-facing entrypoint for build-time Basis code generation.
 *
 * Re-exports the supported `@basis/codegen` API so a consumer can generate
 * TypeScript and JSON Schema from `basis/server` canonical definitions.
 */
export * from '../libraries/codegen'
