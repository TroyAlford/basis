declare module 'postcss-styled-syntax' {
  import type { Syntax } from 'postcss'

  export const parse: Syntax['parse']
  export const stringify: NonNullable<Syntax['stringify']>
}
