import { BASIS_FONTS_URL } from './utilities/fonts'
import { css, style } from './utilities/style'

import './prose.styles.ts'

/**
 * Basis-wide application reset and base typography.
 * Semantic HTML presentation belongs in prose.styles.ts.
 */
style('basis:global', css`
  @import url('${BASIS_FONTS_URL}');

  *, *::before, *::after {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    overflow: hidden;
    padding: 0;
  }

  html {
    font-family: 'Ubuntu', sans-serif;
  }

  button, input, optgroup, select, textarea {
    font: inherit;
  }

  code, pre, kbd, samp {
    font-family: 'Fira Code', monospace;
  }
`)
