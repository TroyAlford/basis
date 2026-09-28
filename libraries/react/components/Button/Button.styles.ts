import { css, style } from '../../utilities/style'

/*
 * Component tokens are read with their defaults as `var()` fallbacks rather
 * than declared on `:root`. A `:root` declaration computes the value once
 * against the root's theme tokens, so a theme applied to a descendant (for
 * example `[data-theme="dark"]`) never reaches the component, and a consumer
 * cannot override the token from an ancestor. The fallback form resolves
 * against the element's own inherited tokens and stays overridable.
 */
style('basis:button', css`
  .button.component {
    align-items: center;
    appearance: none;
    background-color: var(--basis-button-background, var(--basis-color-background));
    border-radius: var(--basis-radius-sm);
    border: var(--basis-button-border, 1px solid var(--basis-button-border-color, var(--basis-color-foreground)));
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

    &:hover:not(.disabled) {
      background-color: var(--basis-button-background-hover, rgb(from var(--basis-color-primary) r g b / 0.25));
    }

    &:focus {
      background-color: var(--basis-button-background-focus, rgb(from var(--basis-color-primary) r g b / 0.5));
      border-color: var(--basis-color-primary);
      outline: none;
    }

    &:disabled, &[disabled] {
      background-color: var(--basis-button-background-disabled, var(--basis-color-disabled));
      color: var(--basis-button-foreground-disabled, var(--basis-color-disabled-text));
      cursor: not-allowed;
      pointer-events: none;
    }
  }
`)
