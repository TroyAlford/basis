import { css, style } from '@basis/react'

export const highlightStyles = style('basis:docs:highlight', css`
  :root {
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300..700&family=Noto+Sans:ital,wght@0,100..900;1,100..900&family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap');
  }
  
  .code.component {
    > code {
      font-family: 'Fira Code', monospace;
      font-variant-ligatures: contextual;
      margin: 0;
      padding: 0;
      
      > pre {
        border-radius: var(--basis-radius-md);
        margin: 0;
        padding: var(--basis-unit-md);
      }
    }
  }
`)
