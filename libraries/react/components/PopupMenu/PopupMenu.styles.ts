import { css, style } from '../../utilities/style'

style('basis:popup-menu', css`
  :root {
    --popup-menu-color-background: var(--basis-color-background);
    --popup-menu-color-border: var(--basis-color-foreground);
    --popup-menu-color-foreground: var(--basis-color-foreground);
    --popup-menu-animation-duration: .125s;
  }

  .popup-menu.component {
    background-color: var(--popup-menu-color-background);
    border: 1px solid var(--popup-menu-color-border);
    border-radius: 4px;
    box-shadow: var(--basis-shadow-md);
    color: var(--popup-menu-color-foreground);
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
