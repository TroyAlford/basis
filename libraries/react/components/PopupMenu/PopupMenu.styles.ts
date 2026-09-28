import { css, style } from '../../utilities/style'

/*
 * Surface tokens are read with their defaults as `var()` fallbacks rather than
 * declared on `:root`. A `:root` declaration computes the value once against
 * the root theme, so a theme applied to a descendant (`[data-theme="dark"]`)
 * never reaches the popup and a consumer cannot override it from an ancestor.
 */
style('basis:popup-menu', css`
  :root {
    --popup-menu-animation-duration: .125s;
  }

  .popup-menu.component {
    background-color: var(--popup-menu-color-background, var(--basis-color-background));
    border: 1px solid var(--popup-menu-color-border, var(--basis-color-foreground));
    border-radius: 4px;
    box-shadow: var(--basis-shadow-md);
    box-sizing: border-box;
    color: var(--popup-menu-color-foreground, var(--basis-color-foreground));
    transition:
      opacity var(--popup-menu-animation-duration) ease,
      visibility var(--popup-menu-animation-duration) linear,
      transform var(--popup-menu-animation-duration) ease
    ;
    white-space: nowrap;

    &[data-visible="true"] {
      opacity: 1;
      visibility: visible;
    }
  }
`)
