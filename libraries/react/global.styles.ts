import { BASIS_FONTS_URL } from './utilities/fonts'
import { css, style } from './utilities/style'

import './prose.styles.ts'

/**
 * Basis's root stylesheet: the library's default typography. Any use of
 * `@basis/react` registers it, so components render in Basis's type (Ubuntu and
 * Fira Code) and screenshot tooling inherits the same defaults.
 */
style('basis:global', css`
  @import url('${BASIS_FONTS_URL}');

  html {
    font-family: 'Ubuntu', sans-serif;
  }

  /*
   * Form controls default to the platform UI font, not the inherited one, which
   * makes their text render differently per host. Inherit Basis's type instead.
   */
  button, input, optgroup, select, textarea {
    font: inherit;
  }

  code, pre, kbd, samp {
    font-family: 'Fira Code', monospace;
  }
`)
