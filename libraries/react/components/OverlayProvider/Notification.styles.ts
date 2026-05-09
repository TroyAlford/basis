import { css, style } from '../../utilities/style'

style('basis:notification', css`
  .notification.component {
    background-color: var(--basis-color-background);
    color: var(--basis-color-foreground);
    border: 1px solid currentColor;
    border-radius: 0.25em;
    display: flex;
    flex-direction: row;
    gap: 0.5em;
    padding: 0.5em;

    > header { font-weight: bold; }
    > section { flex: 1; }
    > .remove { justify-self: flex-end; }
  }
`)
