import { css, style } from '../../utilities/style'
import { AutoCompleteStatus } from './AutoCompleteStatus'

/*
 * Tokens are read with `var(..., default)` fallbacks rather than declared on
 * `:root`, so they resolve against the element's inherited theme (see
 * PopupMenu.styles.ts).
 */
style('basis:auto-complete', css`
  .auto-complete.component {
    display: inline-block;
    position: relative;

    &[data-loading="true"] {
      opacity: 0.7;
    }

    > .text-editor {
      background-color: var(--basis-auto-complete-background, var(--basis-color-background));
    }

    > .popup-menu.menu.component {
      /*
       * Unlike a menu, an autocomplete dropdown renders rich option content, so
       * it wraps instead of forcing a single nowrap line.
       */
      overflow-y: auto;
      padding: var(--basis-auto-complete-padding, var(--basis-unit-sm));
      white-space: normal;

      > .menu-item.component {
        cursor: pointer;
        padding: var(--basis-auto-complete-padding, var(--basis-unit-sm));
        transition: background-color 0.15s ease;
        white-space: normal;

        &:hover {
          background-color: var(--basis-color-primary);
          color: var(--basis-color-primary-contrast);
        }

        &[disabled], &[disabled]:hover {
          background-color: var(--basis-color-disabled);
          color: var(--basis-color-disabled-text);
          cursor: default;
        }
      }

      > [data-state="${AutoCompleteStatus.Error}"],
      > [data-state="${AutoCompleteStatus.Loading}"],
      > [data-state="${AutoCompleteStatus.NotFound}"] {
        color: var(--basis-color-foreground);
        font-style: italic;
        padding: var(--basis-auto-complete-padding, var(--basis-unit-sm));
        text-align: center;
      }

      > [data-state="${AutoCompleteStatus.Loading}"] {
        font-style: italic;
      }

      > [data-state="${AutoCompleteStatus.Error}"] {
        color: var(--basis-color-error);
      }

      > [data-state="${AutoCompleteStatus.NotFound}"] {
        color: var(--basis-color-foreground);
        opacity: 0.7;
      }
    }
  }
`)
