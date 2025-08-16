import { css, style } from '../../utilities/style'

style('basis:dropdown-menu', css`
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

    &[data-direction="S"], &[data-direction="SW"] {
      > .dropdown {
        left: 0;
        top: calc(100% + var(--directional-offset));
      }
    }

    &[data-direction="N"], &[data-direction="NW"] {

      > .dropdown {
        bottom: calc(100% + var(--directional-offset));
        left: 0;
      }
    }

    &[data-direction="E"] > .dropdown {
      left: calc(100% + var(--directional-offset));
      top: 0;
    }

    &[data-direction="W"] > .dropdown {
      right: calc(100% + var(--directional-offset));
      top: 0;
    }

    &[data-direction="NE"] > .dropdown {
      bottom: calc(100% + var(--directional-offset));
      right: 0;
    }

    &[data-direction="SE"] > .dropdown {
      left: 0;
      top: calc(100% + var(--directional-offset));
    }
  }
`)
