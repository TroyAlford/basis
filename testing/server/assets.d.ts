/**
 * Bun bundles an imported image into an emitted asset file and exposes its URL
 * as a string; declare it so the fixture typechecks under the Root tsconfig.
 */
declare module '*.png' {
  const url: string
  // eslint-disable-next-line @basis/no-default-export -- ambient asset modules only have a default.
  export default url
}
