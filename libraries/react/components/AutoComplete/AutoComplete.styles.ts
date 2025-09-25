import { css, style } from '../../utilities/style'

style('basis:auto-complete', css`
  :root {
    --basis-auto-complete-background: var(--basis-color-background);
    --basis-auto-complete-border-radius: var(--basis-radius-sm);
    --basis-auto-complete-border: 1px solid var(--basis-color-foreground);
    --basis-auto-complete-foreground: var(--basis-color-foreground);
    --basis-auto-complete-padding: var(--basis-unit-sm);
  }

  .auto-complete.component {
    display: inline-block;
    position: relative;

    &[data-loading="true"] {
      opacity: 0.7;
    }

    > .text-editor {
      background-color: var(--basis-auto-complete-background);
    }

    > .popup-menu.menu.component {
      overflow-y: auto;
      padding: var(--basis-auto-complete-padding);

      > .menu-item.component {
        cursor: pointer;
        padding: var(--basis-auto-complete-padding);
        transition: background-color 0.15s ease;

        &:hover {
          background-color: var(--basis-color-primary);
          color: var(--basis-color-primary-contrast);
        }

        &.selected {
          background-color: var(--basis-color-primary);
          color: var(--basis-color-contrast);
        }

        &[disabled], &[disabled]:hover {
          background-color: var(--basis-color-disabled);
          color: var(--basis-color-disabled-text);
          cursor: default;
        }
      }

      > .error,
      > .loading,
      > .not-found {
        color: var(--basis-color-foreground);
        font-style: italic;
        padding: var(--basis-auto-complete-padding);
        text-align: center;
      }

      > .loading {
        font-style: italic;
      }

      > .error {
        color: var(--basis-color-error);
      }

      > .not-found {
        color: var(--basis-color-foreground);
        opacity: 0.7;
      }
    }
  }
`)
