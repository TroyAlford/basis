import { css, style } from '../../utilities/style'

style('basis:dropdown-menu', css`
  :root {
    --dropdown-menu-offset: 0px;
  }

  .dropdown-menu.component {
    display: inline-block;
    isolation: isolate;
    position: relative;

    > .dropdown {
      background-color: var(--basis-color-background);
      border: 1px solid var(--basis-color-foreground);
      box-shadow: var(--basis-shadow-md);
      min-width: 200px;
      position: absolute;
      z-index: 1;
    }

    /* Default South direction (below trigger) */
    &[data-direction="S"], &[data-direction="SW"] {
      > .dropdown {
        left: 0;
        top: calc(100% + var(--dropdown-menu-offset));
      }
    }

    /* North direction (above trigger) */
    &[data-direction="N"], &[data-direction="NW"] {
      > .dropdown {
        bottom: calc(100% + var(--dropdown-menu-offset));
        left: 0;
      }
    }

    /* East direction (right of trigger) */
    &[data-direction="E"] > .dropdown {
      left: calc(100% + var(--dropdown-menu-offset));
      top: 0;
    }

    /* West direction (left of trigger) */
    &[data-direction="W"] > .dropdown {
      right: calc(100% + var(--dropdown-menu-offset));
      top: 0;
    }

    /* Northeast direction (above and right of trigger) */
    &[data-direction="NE"] > .dropdown {
      bottom: calc(100% + var(--dropdown-menu-offset));
      right: 0;
    }

    /* Southeast direction (below and right of trigger) */
    &[data-direction="SE"] > .dropdown {
      right: 0;
      top: calc(100% + var(--dropdown-menu-offset));
    }
  }
`)
