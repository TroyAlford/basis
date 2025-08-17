import { css, style } from '../../utilities/style'

style('basis:tooltip', css`
  :root {
    --tooltip-animation-duration: .125s;
    --tooltip-color-background: var(--basis-color-background);
    --tooltip-color-border: var(--basis-color-foreground);
    --tooltip-color-foreground: var(--basis-color-foreground);
  }

  .tooltip.component {
    inset: calc(var(--directional-offset) * -1);
    opacity: 0;
    position: absolute;
    pointer-events: none;
    transition:
      opacity var(--tooltip-animation-duration) ease,
      visibility var(--tooltip-animation-duration) linear,
      transform var(--tooltip-animation-duration) ease
    ;
    visibility: hidden;

    *:has(> &) {
      &:is(:hover, :focus-within) > .tooltip.component {
        opacity: 1;
        visibility: visible;
        z-index: 1;
      }
    }

    &[data-visible="true"] {
      opacity: 1;
      visibility: visible;
      z-index: 1;
    }

    > .bubble {
      background-color: var(--tooltip-color-background);
      border: 1px solid var(--tooltip-color-border);
      border-radius: 4px;
      color: var(--tooltip-color-foreground);
      padding: 8px;
      position: absolute;
    }

    > .arrow {
      background-color: var(--tooltip-color-background);
      border: 1px solid var(--tooltip-color-border);
      border-width: 1px 1px 0 0;
      height: 8px;
      position: absolute;
      width: 8px;
    }

    &[data-direction^="N"] {
      > .bubble, > .arrow { bottom: calc(100%); }
      > .bubble { margin-bottom: 4px; }
      > .arrow { transform: rotate(135deg); }
    }

    &[data-direction^="S"] {
      > .bubble, > .arrow { top: calc(100%); }
      > .bubble { margin-top: 4px; }
      > .arrow { transform: rotate(-45deg); }
    }

    &[data-direction="NW"], &[data-direction="SW"] {
      > .bubble { left: 0; }
      > .arrow { left: 8px; }
    }
    &[data-direction="NE"], &[data-direction="SE"] {
      > .bubble { right: 0; }
      > .arrow { right: 8px; }
    }

    &[data-direction="S"], &[data-direction="N"] {
      > .bubble {
        left: 50%;
        transform: translateX(-50%);
      }
      > .arrow { left: calc(50% - 4px); }
    }

    &[data-direction="E"] {
      > .bubble {
        left: calc(100% + 4px);
        transform: translate(4px, -50%);
        top: 50%;
      }
      
      > .arrow {
        top: calc(50% - 4px);
        left: calc(100% + 4px);
        transform: rotate(-135deg);
      }
    }

    &[data-direction="W"] {
      > .bubble {
        right: calc(100% + 4px);
        top: 50%;
        transform: translate(-4px, -50%);
      }

      > .arrow {
        right: calc(100% + 4px);
        top: calc(50% - 4px);
        transform: rotate(45deg);
      }
    }
  }
`)
