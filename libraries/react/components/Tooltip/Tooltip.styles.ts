import { css, style } from '../../utilities/style'

style('basis:tooltip', css`
  :root {
    --tooltip-animation-duration: .125s;
    --tooltip-color-background: var(--basis-color-background);
    --tooltip-color-border: var(--basis-color-foreground);
    --tooltip-color-foreground: var(--basis-color-foreground);
  }

  .tooltip.component {
    background-color: var(--tooltip-color-background);
    border: 1px solid var(--tooltip-color-border);
    border-radius: 4px;
    box-shadow: var(--basis-shadow-md);
    color: var(--tooltip-color-foreground);
    opacity: 0;
    padding: 8px;
    pointer-events: none;
    transition:
      opacity var(--tooltip-animation-duration) ease,
      visibility var(--tooltip-animation-duration) linear,
      transform var(--tooltip-animation-duration) ease
    ;
    visibility: hidden;
    white-space: nowrap;
    z-index: var(--basis-z-tooltip, 2);

    *:has(> &) {
      &:is(:hover, :focus-within) > .tooltip.component {
        opacity: 1;
        visibility: visible;
      }
    }

    &[data-visible="true"] {
      opacity: 1;
      visibility: visible;
    }
  }
`)
