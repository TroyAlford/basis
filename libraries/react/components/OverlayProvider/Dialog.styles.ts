import { css, style } from '../../utilities/style'

style('basis:dialog', css`
  .dialog.component {
    background-color: var(--basis-color-background);
    color: var(--basis-color-foreground);
    border: 1px solid currentColor;
    border-radius: 0.5em;
    display: flex;
    flex-direction: column;
    gap: .5em;

    > header {
      font-weight: bold;
      font-size: var(--basis-font-size-lg);
    }

    > section {

    }

    > footer {
      display: flex;
      gap: .25em;
      justify-content: flex-end;
    }
  }
`)
