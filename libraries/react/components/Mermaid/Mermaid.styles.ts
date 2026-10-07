import { css, style } from '../../utilities/style'

style('basis:mermaid', css`
  .mermaid-diagram.component {
    .diagram svg {
      max-width: 100%;
    }
    pre.mermaid {
      background: none;
      text-align: center;
    }
  }
`)
