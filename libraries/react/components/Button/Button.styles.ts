import { css, style } from '../../utilities/style'

style('basis:button', css`
  :root {
    --basis-button-background-disabled: var(--basis-color-disabled);
    --basis-button-background-hover: rgb(from var(--basis-color-primary) r g b / 0.25);
    --basis-button-background-focus: rgb(from var(--basis-color-primary) r g b / 0.5);
    --basis-button-background: var(--basis-color-background);
    --basis-button-border-color: var(--basis-color-foreground);
    --basis-button-border: 1px solid var(--basis-button-border-color);
    --basis-button-foreground-disabled: var(--basis-color-disabled-text);
    --basis-button-foreground: var(--basis-color-foreground);
    --basis-button-shadow-color: var(--basis-color-primary);
    --basis-button-shadow: 0 0 0 3px var(--basis-button-shadow-color);
  }

  .button.component {
    align-items: center;
    appearance: none;
    background-color: var(--basis-button-background);
    border-radius: var(--basis-radius-sm);
    border: var(--basis-button-border);
    color: var(--basis-button-foreground);
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

    &:hover:not(.disabled) {
      background-color: var(--basis-button-background-hover);
    }

    &:focus {
      background-color: var(--basis-button-background-focus);
      border-color: var(--basis-color-primary);
      outline: none;
    }

    &:disabled, &[disabled] {
      background-color: var(--basis-button-background-disabled);
      color: var(--basis-button-foreground-disabled);
      cursor: not-allowed;
      pointer-events: none;
    }
  } 
`)
