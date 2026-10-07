import { css } from '../../utilities/style'

/**
 * The Google Fonts stylesheet Basis documentation type is designed around:
 * Noto Sans for prose, Ubuntu for UI and headings.
 */
export const DOCUMENTATION_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap'

/**
 * Basis documentation typography: the body type scale and palette. Exported so
 * the server can inline it alongside the documentation shell.
 */
export const documentationStyles = css`
  html, body {
    background-color: var(--basis-color-background);
    color: var(--basis-color-foreground);
    font-family: 'Ubuntu', sans-serif;
    font-size: var(--basis-font-size-md);
    margin: 0;
    padding: 0;
  }
`
