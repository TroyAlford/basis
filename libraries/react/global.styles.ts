import { BASIS_FONTS_URL } from './utilities/fonts'
import { css, style } from './utilities/style'

/**
 * Basis's root stylesheet: the library's default typography. Any use of
 * `@basis/react` registers it, so components render in Basis's type (Ubuntu and
 * Fira Code) and screenshot tooling inherits the same defaults.
 */
style('basis:global', css`
  @import url('${BASIS_FONTS_URL}');

  html, body {
    font-family: 'Ubuntu', sans-serif;
    margin: 0;
    padding: 0;
  }

  code, pre, kbd, samp {
    font-family: 'Fira Code', monospace;
  }
`)
