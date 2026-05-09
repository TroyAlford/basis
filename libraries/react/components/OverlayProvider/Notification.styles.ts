import { Intent } from '@basis/react/types/Intent'
import { css, style } from '../../utilities/style'

style('basis:notification', css`
  .notification.component {
    background-color: var(--basis-color-background);
    border: 1px solid var(--basis-color-foreground);
    border-radius: 0.25em;
    color: var(--basis-color-foreground);
    display: flex;
    flex-direction: row;
    gap: 0.5em;
    padding: 0;

    &[data-intent="${Intent.Danger}"] {
      background-color: var(--basis-color-danger);
      border-color: var(--basis-color-danger);
      color: var(--basis-color-danger-contrast);
    }

    &[data-intent="${Intent.Primary}"] {
      background-color: var(--basis-color-primary);
      border-color: var(--basis-color-primary);
      color: var(--basis-color-contrast);
    }

    > header { font-weight: bold; }
    > section { flex: 1; }
    > .remove { justify-self: flex-end; }
  }
`)
