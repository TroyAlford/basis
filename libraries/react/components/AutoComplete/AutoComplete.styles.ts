import { css, style } from '../../utilities/style'

/**
 * The finite content-state values the stylesheet selects on. Supplied by
 * `AutoComplete` so the component and its CSS consume one typed vocabulary
 * without a module cycle.
 */
export interface AutoCompleteStatusValues {
  /** The search completed with an error. */
  Error: string,
  /** A search is in flight. */
  Loading: string,
  /** The search completed with no matching options. */
  NotFound: string,
}

/**
 * Register the AutoComplete stylesheet.
 * @param status - The component's status vocabulary.
 */
export const autoCompleteStyles = (status: AutoCompleteStatusValues): void => {
  style('basis:auto-complete', css`
    :root {
      --basis-auto-complete-background: var(--basis-color-background);
      --basis-auto-complete-border: 1px solid var(--basis-color-foreground);
      --basis-auto-complete-border-radius: var(--basis-radius-sm);
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

          &[disabled], &[disabled]:hover {
            background-color: var(--basis-color-disabled);
            color: var(--basis-color-disabled-text);
            cursor: default;
          }
        }

        > [data-state="${status.Error}"],
        > [data-state="${status.Loading}"],
        > [data-state="${status.NotFound}"] {
          color: var(--basis-color-foreground);
          font-style: italic;
          padding: var(--basis-auto-complete-padding);
          text-align: center;
        }

        > [data-state="${status.Loading}"] {
          font-style: italic;
        }

        > [data-state="${status.Error}"] {
          color: var(--basis-color-error);
        }

        > [data-state="${status.NotFound}"] {
          color: var(--basis-color-foreground);
          opacity: 0.7;
        }
      }
    }
  `)
}
