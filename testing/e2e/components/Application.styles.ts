import { css, style } from '@basis/react'

style('basis:application', css`
  .application.component {
    > header {
      > nav {
        > a { color: red; }
      }
    }
  }
`)
