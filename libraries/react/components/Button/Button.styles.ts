import { css, style } from '../../utilities/style'

style('basis:button', css`
  .button.component {
    align-items: center;
    appearance: none;
    background-color: var(--basis-button-background, var(--basis-color-surface));
    border: var(--basis-button-border, 1px solid var(--basis-button-border-color, var(--basis-color-border)));
    border-radius: var(--basis-radius-sm);
    color: var(--basis-button-foreground, var(--basis-color-foreground));
    cursor: pointer;
    display: inline-flex;
    font-family: inherit;
    justify-content: center;
    margin: 0;
    padding: .25em;
    position: relative;
    text-decoration: none;
    transition: all 50ms ease-in-out;
    user-select: none;
    white-space: nowrap;

    &:hover:not(:disabled) {
      background-color: var(--basis-button-background-hover, var(--basis-color-hover));
    }

    &:focus {
      background-color: var(--basis-button-background-focus, var(--basis-color-selection));
      border-color: var(--basis-button-border-color, var(--basis-color-focus));
      outline: none;
    }

    &[aria-pressed="true"], &[aria-selected="true"] {
      background-color: var(--basis-button-background-selected, var(--basis-color-selection));
      border-color: var(--basis-button-border-color, var(--basis-color-focus));
    }

    &:disabled, &[disabled] {
      background-color: var(--basis-button-background-disabled, var(--basis-color-disabled));
      color: var(--basis-button-foreground-disabled, var(--basis-color-disabled-text));
      cursor: not-allowed;
      pointer-events: none;
    }
  }
`)
